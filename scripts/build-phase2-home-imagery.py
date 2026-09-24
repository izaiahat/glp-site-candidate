#!/usr/bin/env python3
"""Build and validate the Phase 2 homepage image families.

The four operator-approved source PNGs are retained inside the candidate. This
local-only step deterministically crops, encodes, mirrors, and hashes the exact
responsive assets consumed by the homepage. It never calls a network service.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "artifacts/ultracode/phase2-home/source"
DERIVATIVES = ROOT / "assets/derivatives"
PUBLIC = ROOT / "public/assets/images"
MANIFEST = ROOT / "artifacts/ultracode/phase2-home/generated-image-lineage.json"
SOURCES = {
    "home-hero-fruit": SOURCE_ROOT / "home-hero-fruit.png",
    "home-hero-fridge": SOURCE_ROOT / "home-hero-fridge.png",
    "home-hero-hand": SOURCE_ROOT / "home-hero-hand.png",
    "home-lifestyle-phone": SOURCE_ROOT / "home-lifestyle-phone.png",
}
TARGETS = {
    "home-hero-fruit": ((640, 640), (1024, 1024)),
    "home-hero-fridge": ((640, 640), (1024, 1024)),
    "home-hero-hand": ((640, 640), (1024, 1024)),
    "home-lifestyle-phone": ((768, 512), (1536, 1024)),
}
# The approved hand source includes a white presentation mat outside its
# rounded scene. Crop that non-scene border before responsive encoding so the
# served square cannot expose bilateral white bars.
SOURCE_CROPS = {
    "home-hero-hand": (108, 108, 916, 916),
}
FORMATS: dict[str, dict[str, Any]] = {
    "avif": {"quality": 68},
    "webp": {"quality": 82, "method": 6},
    "jpg": {"quality": 86, "optimize": True, "progressive": True},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_fit(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    framed = ImageOps.fit(source.convert("RGB"), size, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    clean = Image.new("RGB", size)
    clean.paste(framed)
    return clean


def save_clean(image: Image.Image, path: Path) -> None:
    suffix = path.suffix[1:].lower()
    fmt = "JPEG" if suffix == "jpg" else suffix.upper()
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format=fmt, **FORMATS[suffix])


def build() -> dict[str, Any]:
    source_rows = []
    output_rows = []
    for stem, source_path in SOURCES.items():
        if not source_path.exists():
            raise RuntimeError(f"phase2_home_source_missing:{source_path}")
        source_rows.append({
            "stem": stem,
            "path": str(source_path.relative_to(ROOT)),
            "sha256": sha256(source_path),
            "bytes": source_path.stat().st_size,
        })
        with Image.open(source_path) as opened:
            opened.load()
            source = opened.convert("RGB").copy()
        if stem in SOURCE_CROPS:
            source = source.crop(SOURCE_CROPS[stem])
        for width, height in TARGETS[stem]:
            framed = clean_fit(source, (width, height))
            for extension in FORMATS:
                name = f"{stem}-{width}.{extension}"
                derivative = DERIVATIVES / name
                public = PUBLIC / name
                save_clean(framed, derivative)
                public.parent.mkdir(parents=True, exist_ok=True)
                public.write_bytes(derivative.read_bytes())
                output_rows.append({
                    "path": str(public.relative_to(ROOT)),
                    "source_mirror": str(derivative.relative_to(ROOT)),
                    "width": width,
                    "height": height,
                    "sha256": sha256(derivative),
                    "bytes": derivative.stat().st_size,
                })
    manifest = {
        "schema": "gcs.phase2.generated-image-lineage.v2",
        "status": "PASS",
        "generation_mode": "candidate-local deterministic Pillow derivatives",
        "original_provider": "OpenAI",
        "original_model": "gpt-image-2-high",
        "network_services_used": 0,
        "competitor_assets_used": 0,
        "qa": "operator-authorized imagery only; no testimonials, reviews, logos, names, or readable labels",
        "sources": source_rows,
        "outputs": output_rows,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def check() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise RuntimeError("phase2_home_manifest_missing")
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("schema") != "gcs.phase2.generated-image-lineage.v2":
        raise RuntimeError("phase2_home_manifest_schema_invalid")
    expected_sources = {str(path.relative_to(ROOT)): sha256(path) for path in SOURCES.values()}
    recorded_sources = {row["path"]: row["sha256"] for row in manifest.get("sources", [])}
    if recorded_sources != expected_sources:
        raise RuntimeError("phase2_home_source_lineage_stale")
    expected_count = sum(len(sizes) for sizes in TARGETS.values()) * len(FORMATS)
    if len(manifest.get("outputs", [])) != expected_count:
        raise RuntimeError("phase2_home_output_count_invalid")
    for row in manifest["outputs"]:
        public = ROOT / row["path"]
        derivative = ROOT / row["source_mirror"]
        for path in (public, derivative):
            if not path.exists() or sha256(path) != row["sha256"]:
                raise RuntimeError(f"phase2_home_hash_mismatch:{path}")
            with Image.open(path) as image:
                image.load()
                if image.size != (row["width"], row["height"]):
                    raise RuntimeError(f"phase2_home_dimensions_invalid:{path}")
                if image.getexif():
                    raise RuntimeError(f"phase2_home_exif_present:{path}")
    return {"status": "PASS", "source_count": len(expected_sources), "output_count": expected_count}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check() if args.check else build()
    print(json.dumps({"status": result["status"], "output_count": len(result.get("outputs", [])) or result.get("output_count", 0)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
