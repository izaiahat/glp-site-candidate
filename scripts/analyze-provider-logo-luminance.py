#!/usr/bin/env python3
"""Build-time luminance analyzer for every provider logo asset.

WHY THIS EXISTS
---------------
2026-08-18 (operator defect): several provider logos are white/light-dominant
artwork on a transparent background. Every chip on the site painted `#fff`, so
those logos rendered as an empty white box - the provider had a logo and the
reader saw nothing. The chip surface was picked by hand in
`data/provider-logo-sources.json` (`surface: light|dark`, meaning "the page we
captured it from"), which is a fact about the SOURCE PAGE, not about the ink,
so it could never self-correct.

WHAT THIS DOES
--------------
Rasterizes every shipped logo asset (webp directly, svg through headless
Chrome), measures the ink, and writes a derived `logo_treatment` onto each row
of `assets/provider-logos/manifest.json`:

    light-chip  ink is dark enough to read on the paper-white chip
    dark-chip   ink is light/white-dominant; the chip must paint a dark neutral

The classification is DERIVED, so a logo swapped tomorrow reclassifies itself.
`npm run build` re-runs this and fails if the manifest is stale, which is what
makes it a gate rather than a one-time fix.

Method
------
* Alpha-aware. A transparent-background asset is judged on its INK only
  (alpha >= 96), weighted by alpha; the padding is not ink and must not drag
  the average toward whatever the chip happens to paint.
* An opaque asset carries its own background (a white or dark box baked into
  the artwork). Judging its "ink" would measure the box. Such an asset is
  classified by the box: a dark box gets a dark chip so the seam disappears;
  a light box keeps the light chip.
* Luminance is WCAG relative luminance and the decision is stated as a contrast
  ratio, so the threshold is a legibility fact rather than a taste call. Light
  is the site's default chip and KEEPS the logo unless the ink actually fails
  on it: a cut-out mark flips to dark only when its contrast on paper-white is
  below the WCAG 1.4.11 non-text minimum of 3:1 AND dark does better. A
  mid-tone mark that still clears 3:1 on white stays on white, because a
  legible logo does not need its brand surface changed.

Usage
    python3 scripts/analyze-provider-logo-luminance.py            # rewrite manifest
    python3 scripts/analyze-provider-logo-luminance.py --check    # fail if stale
    python3 scripts/analyze-provider-logo-luminance.py --report   # print table
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "assets/provider-logos"
MANIFEST = LOGOS / "manifest.json"
CHROME = "/usr/bin/google-chrome"
RSVG_CONVERT = shutil.which("rsvg-convert")

#: The two chip surfaces the renderer can paint. `dark` is `--gcs-ink`-family
#: navy already used by `.provider-logo--dark` (money-page.mjs) and by the
#: site's dark sections, so a dark chip is an existing token, not a new color.
CHIP_LIGHT = (0xFF, 0xFF, 0xFF)
CHIP_DARK = (0x12, 0x24, 0x3A)
INK_ALPHA = 96
#: Below this share of semi-transparent pixels the artwork is treated as
#: carrying its own baked-in background rather than being a cut-out mark.
TRANSPARENCY_SHARE = 0.02
#: WCAG 2.2 SC 1.4.11 non-text contrast minimum. A cut-out mark that clears it
#: on paper-white is legible there and keeps the default chip.
MIN_NON_TEXT_CONTRAST = 3.0
#: An opaque asset's own baked-in background darker than this reads as a dark
#: card; the chip matches it so there is no seam.
OPAQUE_DARK_BOX_LUMINANCE = 0.20
#: The inner box of the standard card chip (150x58 with 8px padding). Used only
#: to derive how much of the chip a transparent asset's actual mark occupies.
CHIP_INNER = (134.0, 42.0)
#: A mark whose own artwork is mostly transparent padding renders tiny inside
#: `object-fit: contain`, because contain fits the CANVAS, not the mark. Where
#: the mark is centred in its canvas we can recover the lost size with a pure
#: CSS scale and no byte change to the asset. Guards: only when it buys a real
#: difference, only when the mark is genuinely centred, and never past 3x.
MIN_CONTENT_SCALE = 1.15
MAX_CONTENT_SCALE = 3.0
CENTERING_TOLERANCE = 0.06


def _srgb_channel(value: float) -> float:
    value = value / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = (_srgb_channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: float, b: float) -> float:
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def _rasterize_svg(path: Path) -> Image.Image:
    """Rasterize SVG without depending on scarce browser-process capacity.

    librsvg is preferred when available because this build gate may run while
    operator-owned Chrome sessions are active. Headless Chrome remains the
    compatibility fallback; neither path mutates or terminates those sessions.
    """
    with tempfile.TemporaryDirectory(prefix="logo-lum-") as tmp:
        tmp_path = Path(tmp)
        shot = tmp_path / "shot.png"
        if RSVG_CONVERT:
            proc = subprocess.run(
                [RSVG_CONVERT, "--width=600", "--height=600", "--keep-aspect-ratio",
                 "--page-width=600", "--page-height=600", "--output", str(shot), str(path)],
                capture_output=True, text=True, timeout=30,
            )
            if proc.returncode == 0 and shot.is_file():
                return Image.open(shot).convert("RGBA").copy()
            raise RuntimeError(f"svg_rasterize_failed:{path.name}:{proc.stderr[-200:]}")

        holder = tmp_path / "logo.html"
        holder.write_text(
            "<!doctype html><meta charset=utf-8>"
            "<style>html,body{margin:0;padding:0;background:transparent}"
            f"img{{display:block;width:600px}}</style>"
            f'<img src="file://{path}">'
        )
        proc = subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             "--disable-background-networking", "--disable-component-update", "--disable-extensions",
             "--no-first-run", "--no-default-browser-check", "--renderer-process-limit=1",
             f"--user-data-dir={tmp_path / 'chrome-profile'}",
             "--default-background-color=00000000", "--force-device-scale-factor=1",
             "--window-size=600,600", f"--screenshot={shot}", f"file://{holder}"],
            capture_output=True, text=True, timeout=120)
        if not shot.is_file():
            raise RuntimeError(f"svg_rasterize_failed:{path.name}:{proc.stderr[-200:]}")
        return Image.open(shot).convert("RGBA").copy()


def _content_scale(image: Image.Image) -> dict[str, Any]:
    """How much of the chip the actual mark loses to its own transparent canvas."""
    width, height = image.size
    box = image.split()[3].getbbox()
    if not box:
        return {"content_scale": 1.0, "reason": "no_alpha_bbox"}
    left, top, right, bottom = box
    mark_w, mark_h = right - left, bottom - top
    offset_x = abs(((left + right) / 2) - width / 2) / width
    offset_y = abs(((top + bottom) / 2) - height / 2) / height
    detail = {"mark_box": [left, top, right, bottom],
              "mark_share": [round(mark_w / width, 3), round(mark_h / height, 3)],
              "center_offset": [round(offset_x, 3), round(offset_y, 3)]}
    if offset_x > CENTERING_TOLERANCE or offset_y > CENTERING_TOLERANCE:
        # An off-centre mark would drift out of the chip when scaled about the
        # centre, so it keeps its natural size rather than risking a crop.
        return {"content_scale": 1.0, "reason": "mark_not_centred_in_canvas", **detail}
    chip_w, chip_h = CHIP_INNER
    fit_canvas = min(chip_w / width, chip_h / height)
    fit_mark = min(chip_w / mark_w, chip_h / mark_h)
    scale = fit_mark / fit_canvas if fit_canvas else 1.0
    if scale < MIN_CONTENT_SCALE:
        return {"content_scale": 1.0, "reason": "mark_already_fills_the_chip", **detail}
    return {"content_scale": round(min(scale, MAX_CONTENT_SCALE), 3),
            "reason": "mark_upscaled_to_fill_chip", **detail}


def measure(path: Path) -> dict[str, Any]:
    image = _rasterize_svg(path) if path.suffix == ".svg" else Image.open(path).convert("RGBA")
    fit = _content_scale(image)
    image.thumbnail((320, 320))
    pixels = list(image.getdata())
    total = len(pixels)
    translucent = sum(1 for _, _, _, a in pixels if a < 250)
    has_alpha = translucent / total > TRANSPARENCY_SHARE
    if has_alpha:
        ink = [(r, g, b, a) for r, g, b, a in pixels if a >= INK_ALPHA]
        basis = "ink_pixels_alpha_weighted"
    else:
        # Opaque artwork: the "ink" question is really about the baked-in box.
        ink = [(r, g, b, 255) for r, g, b, _ in pixels]
        basis = "opaque_artwork_whole_image"
    if not ink:
        raise RuntimeError(f"logo_has_no_measurable_ink:{path.name}")
    weight = sum(a for *_, a in ink)
    mean = tuple(sum(c * a for *rgb, a in ink for c in (rgb[i],)) / weight for i in range(3))
    luminance = relative_luminance(mean)
    on_light = contrast_ratio(luminance, relative_luminance(CHIP_LIGHT))
    on_dark = contrast_ratio(luminance, relative_luminance(CHIP_DARK))
    if has_alpha:
        # Cut-out mark: only an ink that FAILS on paper-white earns a dark chip.
        treatment = "dark-chip" if on_light < MIN_NON_TEXT_CONTRAST and on_dark > on_light else "light-chip"
        reason = ("cut_out_ink_below_wcag_non_text_contrast_on_white" if treatment == "dark-chip"
                  else "cut_out_ink_legible_on_white")
    else:
        # Baked-in box: match the chip to the box so there is no visible seam.
        # (Measuring "ink" here would measure the box, not the mark.)
        treatment = "dark-chip" if luminance < OPAQUE_DARK_BOX_LUMINANCE else "light-chip"
        reason = ("opaque_artwork_dark_box_matched" if treatment == "dark-chip"
                  else "opaque_artwork_light_box_matched")
    return {
        "logo_treatment": treatment,
        "logo_treatment_reason": reason,
        "logo_fit": fit,
        "luminance": {
            "basis": basis,
            "measured_pixels": len(ink),
            "translucent_share": round(translucent / total, 4),
            "mean_ink_rgb": [round(c, 1) for c in mean],
            "relative_luminance": round(luminance, 4),
            "contrast_on_light_chip": round(on_light, 2),
            "contrast_on_dark_chip": round(on_dark, 2),
        },
    }


def analyze() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads(MANIFEST.read_text())
    report = []
    for logo in manifest["logos"]:
        result = measure(LOGOS / logo["output_file"])
        logo["logo_treatment"] = result["logo_treatment"]
        logo["logo_treatment_reason"] = result["logo_treatment_reason"]
        logo["logo_fit"] = result["logo_fit"]
        logo["logo_luminance"] = result["luminance"]
        report.append({"program_id": logo["program_id"], "file": logo["output_file"],
                       "declared_surface": logo.get("surface"), **result["luminance"],
                       "logo_treatment": result["logo_treatment"],
                       "logo_treatment_reason": result["logo_treatment_reason"],
                       "content_scale": result["logo_fit"]["content_scale"]})
    manifest["logo_treatment_schema"] = "glp-provider-logo-treatment-v1"
    manifest["logo_treatment_derived_by"] = "scripts/analyze-provider-logo-luminance.py"
    manifest["logo_treatment_counts"] = {
        "light-chip": sum(1 for row in report if row["logo_treatment"] == "light-chip"),
        "dark-chip": sum(1 for row in report if row["logo_treatment"] == "dark-chip"),
    }
    return manifest, report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail when the manifest is stale")
    ap.add_argument("--report", action="store_true", help="print the per-logo measurement table")
    ns = ap.parse_args()
    manifest, report = analyze()
    body = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if ns.check:
        if MANIFEST.read_text() != body:
            print("logo_treatment_manifest_stale: run scripts/analyze-provider-logo-luminance.py",
                  file=sys.stderr)
            return 1
    else:
        MANIFEST.write_text(body)
    if ns.report:
        for row in sorted(report, key=lambda r: r["relative_luminance"], reverse=True):
            print(f'{row["program_id"]:<46} {row["logo_treatment"]:<11} '
                  f'L={row["relative_luminance"]:.3f} light={row["contrast_on_light_chip"]:.2f} '
                  f'dark={row["contrast_on_dark_chip"]:.2f} scale={row["content_scale"]} {row["basis"]}')
    print(json.dumps({"status": "PASS", "logos": len(report),
                      **manifest["logo_treatment_counts"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
