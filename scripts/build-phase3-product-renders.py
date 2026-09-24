#!/usr/bin/env python3
"""Build and validate the Phase 3 editorial product-render family.

The five original generated PNGs are retained inside the candidate. This
candidate-local step deterministically crops, encodes, mirrors, and hashes the
responsive assets consumed by brand-product pages. It never calls a network
service.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "artifacts/ultracode/phase3-product-renders/source"
DERIVATIVES = ROOT / "assets/derivatives"
PUBLIC = ROOT / "public/assets/images"
MANIFEST = ROOT / "artifacts/ultracode/phase3-product-renders/generated-image-lineage.json"
SOURCES = {
    "wegovy-pill": SOURCE_ROOT / "wegovy-pill.png",
    "wegovy": SOURCE_ROOT / "wegovy.png",
    "ozempic": SOURCE_ROOT / "ozempic.png",
    "mounjaro": SOURCE_ROOT / "mounjaro.png",
    "zepbound": SOURCE_ROOT / "zepbound.png",
}
TARGETS = ((640, 640), (1024, 1024))
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
    source_rows: list[dict[str, Any]] = []
    output_rows: list[dict[str, Any]] = []
    for slug, source_path in SOURCES.items():
        if not source_path.exists():
            raise RuntimeError(f"phase3_product_source_missing:{source_path}")
        source_rows.append({
            "slug": slug,
            "path": str(source_path.relative_to(ROOT)),
            "sha256": sha256(source_path),
            "bytes": source_path.stat().st_size,
        })
        with Image.open(source_path) as opened:
            opened.load()
            source = opened.convert("RGB").copy()
        for width, height in TARGETS:
            framed = clean_fit(source, (width, height))
            for extension in FORMATS:
                name = f"phase3-product-{slug}-{width}.{extension}"
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
        "schema": "gcs.phase3.generated-product-render-lineage.v1",
        "status": "PASS",
        "generation_mode": "candidate-local deterministic Pillow derivatives",
        "original_provider": "OpenAI",
        "original_model": "gpt-image-2-high",
        "network_services_used_by_derivative_step": 0,
        "competitor_assets_used": 0,
        "qa": "original branded representative editorial product renders; exact brand names only; no dosage, claims, fine print, testimonials, people, or exposed needles",
        "sources": source_rows,
        "outputs": output_rows,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def check() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise RuntimeError("phase3_product_manifest_missing")
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("schema") != "gcs.phase3.generated-product-render-lineage.v1":
        raise RuntimeError("phase3_product_manifest_schema_invalid")
    expected_sources = {str(path.relative_to(ROOT)): sha256(path) for path in SOURCES.values()}
    recorded_sources = {row["path"]: row["sha256"] for row in manifest.get("sources", [])}
    if recorded_sources != expected_sources:
        raise RuntimeError("phase3_product_source_lineage_stale")
    expected_count = len(SOURCES) * len(TARGETS) * len(FORMATS)
    if len(manifest.get("outputs", [])) != expected_count:
        raise RuntimeError("phase3_product_output_count_invalid")
    for row in manifest["outputs"]:
        public = ROOT / row["path"]
        derivative = ROOT / row["source_mirror"]
        for path in (public, derivative):
            if not path.exists() or sha256(path) != row["sha256"]:
                raise RuntimeError(f"phase3_product_hash_mismatch:{path}")
            with Image.open(path) as image:
                image.load()
                if image.size != (row["width"], row["height"]):
                    raise RuntimeError(f"phase3_product_dimensions_invalid:{path}")
                if image.getexif():
                    raise RuntimeError(f"phase3_product_exif_present:{path}")
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
