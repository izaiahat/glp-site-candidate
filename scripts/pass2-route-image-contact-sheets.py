#!/usr/bin/env python3
"""Build visual-QA contact sheets for completed PASS 2 route masters."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STATE = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation/state.json")
OUTPUT_DIR = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation/contact-sheets")
COLS = 3
ROWS = 3
CELL_WIDTH = 640
CELL_HEIGHT = 410
IMAGE_HEIGHT = 340


def safe_slug(route: str) -> str:
    return route.strip("/").split("/")[-1] or "home"


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    if not STATE.exists():
        raise RuntimeError("pass2_image_generation_state_missing")
    state = json.loads(STATE.read_text())
    records = [record for record in state.get("records", {}).values() if record.get("status") == "PASS"]
    records.sort(key=lambda record: record["route"])
    if args.require_complete and len(records) != 69:
        raise RuntimeError(f"pass2_image_generation_incomplete:{len(records)}/69")
    hashes = [record["output_sha256"] for record in records]
    if len(hashes) != len(set(hashes)):
        raise RuntimeError("pass2_route_master_duplicate_hash")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sheets = []
    per_sheet = COLS * ROWS
    for offset in range(0, len(records), per_sheet):
        group = records[offset : offset + per_sheet]
        canvas = Image.new("RGB", (COLS * CELL_WIDTH, ROWS * CELL_HEIGHT), "#071a22")
        draw = ImageDraw.Draw(canvas)
        for index, record in enumerate(group):
            row, col = divmod(index, COLS)
            x, y = col * CELL_WIDTH, row * CELL_HEIGHT
            path = Path(record["output_path"])
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != record["output_sha256"]:
                raise RuntimeError(f"pass2_route_master_readback_failed:{record['route']}")
            with Image.open(path) as source:
                source.load()
                image = fit(source.convert("RGB"), CELL_WIDTH, IMAGE_HEIGHT)
            canvas.paste(image, (x, y))
            label = f"{offset + index + 1:02d}  {safe_slug(record['route'])}"
            draw.rectangle((x, y + IMAGE_HEIGHT, x + CELL_WIDTH, y + CELL_HEIGHT), fill="#071a22")
            draw.text((x + 14, y + IMAGE_HEIGHT + 18), label[:75], fill="#f5f6ef", font=ImageFont.load_default(size=16))
        sheet_number = offset // per_sheet + 1
        output = OUTPUT_DIR / f"sheet-{sheet_number:02d}.jpg"
        canvas.save(output, format="JPEG", quality=88, optimize=True)
        sheets.append({
            "path": str(output),
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "routes": [record["route"] for record in group],
        })
    manifest = {
        "schema": "glp-pass2-route-image-contact-sheets-v1",
        "status": "PASS" if len(records) == 73 else "PARTIAL",  # 2026-08-27 live-head merge: +4 guides
        "route_master_count": len(records),
        "unique_route_master_hashes": len(set(hashes)),
        "sheets": sheets,
    }
    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": manifest["status"], "route_master_count": len(records), "sheet_count": len(sheets), "manifest": str(manifest_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
