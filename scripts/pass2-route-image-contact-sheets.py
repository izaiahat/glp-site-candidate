#!/usr/bin/env python3
"""Build visual-QA contact sheets for completed PASS 2 route masters."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ARTICLE_MANIFEST = ROOT / "artifacts/ultracode/article-image-manifest.json"
CONTENT_FILES = (ROOT / "data/blog/content-batch.json", ROOT / "data/blog/content-national-wow-additions.json")
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
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    manifest = json.loads(ARTICLE_MANIFEST.read_text())
    state_pin = manifest.get("route_master_state") or {}
    state_path = ROOT / state_pin.get("path", "")
    if not state_path.is_file() or hashlib.sha256(state_path.read_bytes()).hexdigest() != state_pin.get("sha256"):
        raise RuntimeError("pass2_image_generation_state_unbound")
    state = json.loads(state_path.read_text())
    expected_routes = set()
    source_pins = {row["path"]: row["sha256"] for row in manifest["source_files"]}
    for content_file in CONTENT_FILES:
        relative = str(content_file.relative_to(ROOT))
        if source_pins.get(relative) != hashlib.sha256(content_file.read_bytes()).hexdigest():
            raise RuntimeError(f"pass2_image_generation_content_unbound:{relative}")
        for article in json.loads(content_file.read_text())["articles"]:
            route = article["canonical_path"]
            if route in expected_routes:
                raise RuntimeError(f"pass2_image_generation_duplicate_route:{route}")
            expected_routes.add(route)
    manifest_routes = [record["route"] for record in manifest["records"]]
    if len(manifest_routes) != len(set(manifest_routes)) or set(manifest_routes) != expected_routes:
        raise RuntimeError("pass2_image_generation_manifest_route_mismatch")
    records = [record for record in state.get("records", {}).values() if record.get("status") == "PASS"]
    records.sort(key=lambda record: record["route"])
    manifest_hashes = {record["route"]: record["master_sha256"] for record in manifest["records"]}
    if any(manifest_hashes.get(record["route"]) != record["output_sha256"] for record in records):
        raise RuntimeError("pass2_image_generation_manifest_master_mismatch")
    complete = {record["route"] for record in records} == expected_routes and len(records) == len(expected_routes)
    if args.require_complete and not complete:
        raise RuntimeError(f"pass2_image_generation_incomplete:{len(records)}/{len(expected_routes)}")
    hashes = [record["output_sha256"] for record in records]
    if len(hashes) != len(set(hashes)):
        raise RuntimeError("pass2_route_master_duplicate_hash")
    output_dir.mkdir(parents=True, exist_ok=True)
    sheets = []
    per_sheet = COLS * ROWS
    for offset in range(0, len(records), per_sheet):
        group = records[offset : offset + per_sheet]
        canvas = Image.new("RGB", (COLS * CELL_WIDTH, ROWS * CELL_HEIGHT), "#071a22")
        draw = ImageDraw.Draw(canvas)
        for index, record in enumerate(group):
            row, col = divmod(index, COLS)
            x, y = col * CELL_WIDTH, row * CELL_HEIGHT
            # Historical state paths point at predecessor candidates; use the
            # manifest-bound, vendored master in this candidate instead.
            path = ROOT / "assets/source/article-masters-pass2" / f"guide-{safe_slug(record['route'])}.webp"
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
        output = output_dir / f"sheet-{sheet_number:02d}.jpg"
        canvas.save(output, format="JPEG", quality=88, optimize=True)
        sheets.append({
            "path": str(output),
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "routes": [record["route"] for record in group],
        })
    manifest = {
        "schema": "glp-pass2-route-image-contact-sheets-v1",
        "status": "PASS" if complete else "PARTIAL",
        "route_master_count": len(records),
        "unique_route_master_hashes": len(set(hashes)),
        "sheets": sheets,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": manifest["status"], "route_master_count": len(records), "sheet_count": len(sheets), "manifest": str(manifest_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
