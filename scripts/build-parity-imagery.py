#!/usr/bin/env python3
"""Derive the parity-redesign asset layer from the Higgsfield 4K masters.

The parity homepage introduces two new image families that the old warm-paper
build had no equivalent of:

  * `med-rail-*`  — glossy unbranded pharma renders for the horizontal medication
    rail. These are ABSTRACT compositions (blank vials, blank pens, blank
    tablets) lit by our aurora. They carry no trademark, no packaging and no
    label; the medication name is set on the card in our own display type, in
    markup, never burned into the image.
  * `feat-*`      — the feature-card photography for the trust trio.

Masters live in `assets/masters/` and are committed alongside the derivatives so
the pipeline is reproducible; derivatives land in `assets/derivatives/`, which
`build-staging.mjs` copies wholesale to `public/assets/images/`.

Every family emits AVIF + WebP + JPEG at two widths so the picture elements can
serve modern formats and still degrade. EXIF is dropped on the way through.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "assets" / "masters"
OUT = ROOT / "assets" / "derivatives"

# slug -> (master filename, [(width, height), ...])
# Phase-6 rail media is a landscape 8:5 slot; 640/1280 covers high DPR.
RAIL_BOX = [(640, 400), (1280, 800)]
# Feature cards render at ~360 CSS px wide in a 4:3 box.
FEATURE_BOX = [(720, 540), (1440, 1080)]

FAMILIES: dict[str, tuple[str, list[tuple[int, int]]]] = {
    "med-rail-semaglutide": ("parity-rail-semaglutide-higgsfield.png", RAIL_BOX),
    "med-rail-tirzepatide": ("parity-rail-tirzepatide-higgsfield.png", RAIL_BOX),
    "med-rail-oral": ("parity-rail-oral-higgsfield.png", RAIL_BOX),
    "med-rail-brand": ("parity-rail-brand-higgsfield.png", RAIL_BOX),
    "feat-telehealth": ("parity-feature-telehealth-higgsfield.png", FEATURE_BOX),
    "feat-pharmacy": ("parity-feature-pharmacy-higgsfield.png", FEATURE_BOX),
    "feat-receipts": ("parity-feature-receipts-higgsfield.png", FEATURE_BOX),
}

FORMATS = {
    "avif": {"quality": 62},
    "webp": {"quality": 78, "method": 6},
    "jpg": {"quality": 82, "optimize": True, "progressive": True},
}


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    """Cover-crop to the target box, centred, LANCZOS."""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def save(image: Image.Image, path: Path) -> None:
    suffix = path.suffix[1:]
    fmt = "JPEG" if suffix == "jpg" else suffix.upper()
    # Re-wrap through a clean RGB image so no EXIF or ICC rides along.
    clean = Image.new("RGB", image.size)
    clean.paste(image.convert("RGB"))
    clean.save(path, format=fmt, **FORMATS[suffix])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, list[str]] = {}
    missing = []
    for slug, (master_name, boxes) in FAMILIES.items():
        master = MASTERS / master_name
        if not master.exists():
            missing.append(master_name)
            continue
        with Image.open(master) as source:
            source.load()
            written = []
            for width, height in boxes:
                framed = fit(source, width, height)
                for suffix in FORMATS:
                    target = OUT / f"{slug}-{width}.{suffix}"
                    save(framed, target)
                    written.append(target.name)
        manifest[slug] = written
    if missing:
        print(f"parity_imagery_masters_missing: {missing}", file=sys.stderr)
        return 1
    print(json.dumps({"families": len(manifest), "files": sum(len(v) for v in manifest.values())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
