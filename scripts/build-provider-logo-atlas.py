#!/usr/bin/env python3
"""Build one optimized provider-logo atlas for paid comparison pages."""

from __future__ import annotations

from io import BytesIO
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_MANIFEST = ROOT / "assets/provider-logos/manifest.json"
OUTPUT_IMAGE = ROOT / "assets/provider-logos/pass2-lp-atlas.webp"
OUTPUT_MANIFEST = ROOT / "assets/provider-logos/pass2-lp-atlas.json"
COLUMNS = 8
CELL_WIDTH = 144
CELL_HEIGHT = 69
DISPLAY_WIDTH = 96
DISPLAY_HEIGHT = 46
# 2026-09-02 deploy-fable: raised from 95_000. This is a SUB-budget for one
# sprite, not the page budget. Onboarding 18 providers grew the atlas from
# 68,070 to 96,766 bytes (+42%) because it packs one tile per live provider, so
# the old ceiling made a correct roster growth unbuildable. The PAGE-level guard
# is untouched and still binds independently: validate-lp-speed.mjs enforces
# 15 requests and 300KB transfer per /lp/ route, and the atlas is ~32% of that.
# Kept as a real ceiling with modest headroom, not removed.
MAX_BYTES = 110_000


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_image(path: Path, media_type: str) -> Image.Image:
    if media_type == "image/svg+xml":
        result = subprocess.run(
            ["rsvg-convert", "--width", str(CELL_WIDTH - 24), "--height", str(CELL_HEIGHT - 18), str(path)],
            check=True,
            capture_output=True,
        )
        return Image.open(BytesIO(result.stdout)).convert("RGBA")
    return Image.open(path).convert("RGBA")


def fit(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (255, 255, 255, 0))
    image.thumbnail((CELL_WIDTH - 24, CELL_HEIGHT - 18), Image.Resampling.LANCZOS)
    x = (CELL_WIDTH - image.width) // 2
    y = (CELL_HEIGHT - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    return canvas


def main() -> None:
    source = json.loads(SOURCE_MANIFEST.read_text())
    logos = sorted(source["logos"], key=lambda item: item["program_id"])
    rows = (len(logos) + COLUMNS - 1) // COLUMNS
    atlas = Image.new("RGBA", (COLUMNS * CELL_WIDTH, rows * CELL_HEIGHT), (255, 255, 255, 0))
    entries = []
    for index, logo in enumerate(logos):
        source_path = ROOT / logo["public_path"].lstrip("/")
        if sha256(source_path) != logo["output_sha256"]:
            raise SystemExit(f"provider_logo_source_hash_mismatch:{logo['program_id']}")
        tile = fit(load_image(source_path, logo["media_type"]))
        column = index % COLUMNS
        row = index // COLUMNS
        atlas.alpha_composite(tile, (column * CELL_WIDTH, row * CELL_HEIGHT))
        entries.append({
            "program_id": logo["program_id"],
            "provider": logo["provider"],
            "logo_treatment": logo["logo_treatment"],
            "source_path": logo["public_path"],
            "source_sha256": logo["output_sha256"],
            "display_x": column * DISPLAY_WIDTH,
            "display_y": row * DISPLAY_HEIGHT,
        })
    OUTPUT_IMAGE.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT_IMAGE, "WEBP", quality=76, method=6)
    if OUTPUT_IMAGE.stat().st_size > MAX_BYTES:
        raise SystemExit(f"provider_logo_atlas_budget_exceeded:{OUTPUT_IMAGE.stat().st_size}:{MAX_BYTES}")
    manifest = {
        "schema": "glp-provider-logo-lp-atlas-v1",
        "status": "PASS",
        "source_manifest_sha256": sha256(SOURCE_MANIFEST),
        "public_path": "/assets/provider-logos/pass2-lp-atlas.webp",
        "atlas_sha256": sha256(OUTPUT_IMAGE),
        "atlas_bytes": OUTPUT_IMAGE.stat().st_size,
        "atlas_width": atlas.width,
        "atlas_height": atlas.height,
        "display_width": DISPLAY_WIDTH,
        "display_height": DISPLAY_HEIGHT,
        "display_atlas_width": COLUMNS * DISPLAY_WIDTH,
        "display_atlas_height": rows * DISPLAY_HEIGHT,
        "entry_count": len(entries),
        "entries": entries,
    }
    OUTPUT_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "entries": len(entries), "bytes": manifest["atlas_bytes"], "sha256": manifest["atlas_sha256"]}))


if __name__ == "__main__":
    main()
