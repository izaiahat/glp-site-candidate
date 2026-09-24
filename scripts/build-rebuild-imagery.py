#!/usr/bin/env python3
"""Derive the rebuild's premium imagery families from vetted Higgsfield masters.

REBUILD B-14/B-26 asset pass. The operator's directive for the rebuild was
"top quality pictures... look amazing", and the Wow Standard governs how they are
made: generate variants, inspect at full resolution, select one, then optimise
into the site's existing responsive family so the perf budget is never the price
of the picture.

This script is the SELECTION -> DERIVATION half of that. Generation happens in
the Higgsfield lane; the chosen master lands in `assets/masters/` and this turns
it into exactly the family every template already knows how to consume:

    <key>-800.avif  <key>-800.webp  <key>-800.jpg
    <key>-1600.avif <key>-1600.webp <key>-1600.jpg
    <key>-og.jpg

It matches `scripts/process_visual_assets.py`'s contract (same sizes, same
formats, same quality targets, EXIF stripped) so the two lanes cannot drift.

    python3 scripts/build-rebuild-imagery.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "assets" / "masters"
OUT = ROOT / "assets" / "derivatives"

# key -> master filename. Every master is a variant-selected, full-resolution
# inspection PASS (see the rebuild build report's asset table for the note).
ASSETS = {
    "home-evidence": "home-wellness-room-higgsfield.png",
    "home-verify": "home-verify-higgsfield.png",
    "home-compare": "home-compare-higgsfield.png",
}
SIZES = ((800, 450), (1600, 900))
OG = (1200, 630)
# The homepage hero is a full-bleed BAND, not an inline picture: the band paints
# the photograph behind a left-to-right paper fade, so the headline sits on flat
# paper and the room opens to the right. One background beats one background plus
# one inline image on both weight and composition.
BAND = {"home-evidence": "home-hero-band"}
BAND_SIZES = ((1280, 543), (2560, 1086))
# The band is a BACKGROUND behind a paper fade at 2560px wide: most of it is
# out-of-focus wall and curtain, and the left 40% is covered by the fade. It gets
# its own quality floor so a photographic hero cannot quietly eat the whole
# per-template transfer budget the way a full-quality 2560px frame would.
BAND_FORMATS = {"avif": {"quality": 42}, "webp": {"quality": 62, "method": 6}, "jpg": {"quality": 70, "optimize": True, "progressive": True}}
FORMATS = {"avif": {"quality": 68}, "webp": {"quality": 80, "method": 6}, "jpg": {"quality": 84, "optimize": True, "progressive": True}}


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def save(image: Image.Image, path: Path, formats=None) -> None:
    suffix = path.suffix[1:]
    fmt = "JPEG" if suffix == "jpg" else suffix.upper()
    # A fresh image object with no `info` carries no EXIF, no ICC, no GPS.
    clean = Image.new("RGB", image.size)
    clean.putdata(list(image.convert("RGB").getdata()))
    clean.save(path, format=fmt, **(formats or FORMATS)[suffix])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for key, master_name in ASSETS.items():
        master = MASTERS / master_name
        if not master.exists():
            raise SystemExit(f"missing master for {key}: {master}")
        source = Image.open(master).convert("RGB")
        written = {}
        for width, height in SIZES:
            frame = fit(source, width, height)
            for suffix in FORMATS:
                path = OUT / f"{key}-{width}.{suffix}"
                save(frame, path)
                written[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        og_path = OUT / f"{key}-og.jpg"
        save(fit(source, *OG), og_path)
        written[og_path.name] = hashlib.sha256(og_path.read_bytes()).hexdigest()
        for width, height in BAND_SIZES if key in BAND else ():
            frame = fit(source, width, height)
            for suffix in ("avif", "webp", "jpg"):
                path_out = OUT / f"{BAND[key]}-{width}.{suffix}"
                if width == 1280 and suffix == "avif":
                    continue  # the 1280 family never shipped an AVIF; keep the set identical
                save(frame, path_out, BAND_FORMATS)
                written[path_out.name] = hashlib.sha256(path_out.read_bytes()).hexdigest()
        manifest[key] = {"master": master_name, "master_sha256": hashlib.sha256(master.read_bytes()).hexdigest(), "derivatives": written}
    print(json.dumps({"schema": "glp-rebuild-imagery-v1", "assets": manifest}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
