#!/usr/bin/env python3
"""Build and verify the operator-approved Pass 3 H17 image families.

The generated source masters remain inside the candidate. This local-only step
crops them to the 16:9 H17 frame, writes responsive formats, mirrors the exact
served assets, and records deterministic lineage. It never calls the network.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "assets/masters"
DERIVATIVES = ROOT / "assets/derivatives"
PUBLIC = ROOT / "public/assets/images"
MANIFEST = ROOT / "artifacts/ultracode/pass3-h17/generated-image-lineage.json"
SOURCES = {
    "pass3-h17-shipping": {
        "path": MASTERS / "pass3-h17-shipping.png",
        "alt": "A temperature-controlled delivery kit arranged on a dark wood surface",
        "provider_source": "/home/ubuntu/.hermes/cache/images/openai_gpt-image-2-high_20260826_013132_831663e8.png",
    },
    "pass3-h17-schedule": {
        "path": MASTERS / "pass3-h17-schedule.png",
        "alt": "A telehealth workspace with a tablet, clock, notebook, and plant",
        "provider_source": "/home/ubuntu/.hermes/cache/images/openai_gpt-image-2-high_20260826_013124_caa1a4da.png",
    },
}
TARGETS = ((800, 450), (1600, 900))
FORMATS: dict[str, dict[str, Any]] = {
    "avif": {"quality": 68},
    "webp": {"quality": 82, "method": 6},
    "jpg": {"quality": 86, "optimize": True, "progressive": True},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_fit(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    framed = ImageOps.fit(
        source.convert("RGB"),
        size,
        Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    clean = Image.new("RGB", size)
    clean.paste(framed)
    return clean


def save_clean(image: Image.Image, path: Path) -> None:
    suffix = path.suffix[1:].lower()
    image_format = "JPEG" if suffix == "jpg" else suffix.upper()
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format=image_format, **FORMATS[suffix])


def build() -> dict[str, Any]:
    source_rows: list[dict[str, Any]] = []
    output_rows: list[dict[str, Any]] = []
    for stem, spec in SOURCES.items():
        source_path = spec["path"]
        if not source_path.exists():
            raise RuntimeError(f"pass3_h17_source_missing:{source_path}")
        with Image.open(source_path) as opened:
            opened.load()
            source_size = list(opened.size)
            source = opened.convert("RGB").copy()
        source_rows.append(
            {
                "stem": stem,
                "path": str(source_path.relative_to(ROOT)),
                "provider_source": spec["provider_source"],
                "sha256": sha256(source_path),
                "bytes": source_path.stat().st_size,
                "width": source_size[0],
                "height": source_size[1],
                "alt": spec["alt"],
            }
        )
        for width, height in TARGETS:
            framed = clean_fit(source, (width, height))
            for extension in FORMATS:
                name = f"{stem}-{width}.{extension}"
                derivative = DERIVATIVES / name
                public = PUBLIC / name
                save_clean(framed, derivative)
                public.parent.mkdir(parents=True, exist_ok=True)
                public.write_bytes(derivative.read_bytes())
                output_rows.append(
                    {
                        "path": str(public.relative_to(ROOT)),
                        "source_mirror": str(derivative.relative_to(ROOT)),
                        "width": width,
                        "height": height,
                        "sha256": sha256(derivative),
                        "bytes": derivative.stat().st_size,
                    }
                )
    manifest = {
        "schema": "gcs.pass3.h17.generated-image-lineage.v1",
        "status": "PASS",
        "generation_mode": "candidate-local deterministic Pillow derivatives",
        "original_provider": "OpenAI",
        "original_model": "gpt-image-2-high",
        "network_services_used_by_derivative_build": 0,
        "competitor_assets_used": 0,
        "qa": "operator-authorized house-style art; no testimonials, reviews, logos, names, claims, exposed needles, or readable labels",
        "sources": source_rows,
        "outputs": output_rows,
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def check() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise RuntimeError("pass3_h17_manifest_missing")
    manifest = json.loads(MANIFEST.read_text())
    if manifest.get("schema") != "gcs.pass3.h17.generated-image-lineage.v1":
        raise RuntimeError("pass3_h17_manifest_schema_invalid")
    expected_sources = {
        str(spec["path"].relative_to(ROOT)): sha256(spec["path"])
        for spec in SOURCES.values()
    }
    recorded_sources = {
        row["path"]: row["sha256"] for row in manifest.get("sources", [])
    }
    if recorded_sources != expected_sources:
        raise RuntimeError("pass3_h17_source_lineage_stale")
    expected_count = len(SOURCES) * len(TARGETS) * len(FORMATS)
    if len(manifest.get("outputs", [])) != expected_count:
        raise RuntimeError("pass3_h17_output_count_invalid")
    for row in manifest["outputs"]:
        public = ROOT / row["path"]
        derivative = ROOT / row["source_mirror"]
        for path in (public, derivative):
            if not path.exists() or sha256(path) != row["sha256"]:
                raise RuntimeError(f"pass3_h17_hash_mismatch:{path}")
            with Image.open(path) as image:
                image.load()
                if image.size != (row["width"], row["height"]):
                    raise RuntimeError(f"pass3_h17_dimensions_invalid:{path}")
                if image.getexif():
                    raise RuntimeError(f"pass3_h17_exif_present:{path}")
    return {
        "status": "PASS",
        "source_count": len(expected_sources),
        "output_count": expected_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check() if args.check else build()
    print(
        json.dumps(
            {
                "status": result["status"],
                "source_count": len(result.get("sources", []))
                or result.get("source_count", 0),
                "output_count": len(result.get("outputs", []))
                or result.get("output_count", 0),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
