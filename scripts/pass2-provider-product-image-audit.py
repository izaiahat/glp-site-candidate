#!/usr/bin/env python3
"""Fail-closed audit and contact sheets for provider/product Pass 2 artwork."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PROVIDER_MANIFEST = ROOT / "artifacts/ultracode/pass2-provider-review-image-manifest.json"
PRODUCT_MANIFEST = ROOT / "artifacts/ultracode/pass2-product-comparison-image-manifest.json"
REPORT_DIR = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-provider-product-images")
REPORT_PATH = REPORT_DIR / "audit.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dhash(path: Path) -> int:
    with Image.open(path) as image:
        gray = image.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
        pixels = [cast(int, gray.getpixel((x, y))) for y in range(8) for x in range(9)]
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | int(pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    return value


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def load_manifest(path: Path, schema: str, expected: int) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"manifest_missing:{path}")
    payload = json.loads(path.read_text())
    declared = payload.get("expected", payload.get("provider_count"))
    passed = payload.get("passed_count", len(payload.get("records", [])))
    if payload.get("schema") != schema or payload.get("status") != "PASS" or declared != expected or passed != expected or len(payload.get("records", [])) != expected:
        raise RuntimeError(f"manifest_contract_invalid:{path}")
    return payload


def audit_records(manifest: dict[str, Any], family: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    verified: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    hashes: dict[str, str] = {}
    visual_hashes: dict[str, int] = {}
    for record in manifest["records"]:
        identifier = record.get("program_id") or record.get("id")
        master_relative = record.get("master_path") or record.get("output_relative_path")
        master_sha = record.get("master_sha256") or record.get("output_sha256")
        master = ROOT / master_relative
        try:
            if not master.exists() or sha(master) != master_sha:
                raise RuntimeError("master_hash_mismatch")
            if master_sha in hashes:
                raise RuntimeError(f"duplicate_master:{hashes[master_sha]}")
            hashes[master_sha] = identifier
            visual_hashes[identifier] = dhash(master)
            outputs = record.get("outputs") or record.get("derivatives") or []
            if len(outputs) != 6:
                raise RuntimeError(f"derivative_count:{len(outputs)}")
            for output in outputs:
                path = ROOT / output["path"]
                if not path.exists() or sha(path) != output["sha256"] or path.stat().st_size != output["bytes"]:
                    raise RuntimeError(f"derivative_integrity:{output['path']}")
                with Image.open(path) as image:
                    if [image.width, image.height] != [output["width"], output["height"]]:
                        raise RuntimeError(f"derivative_dimensions:{output['path']}")
            verified.append({"id": identifier, "master_path": master_relative, "master_sha256": master_sha, "outputs": len(outputs)})
        except Exception as error:
            failures.append({"id": identifier, "error": str(error)})
    pairs = []
    ids = sorted(visual_hashes)
    minimum = 64
    for index, left in enumerate(ids):
        for right in ids[index + 1:]:
            distance = hamming(visual_hashes[left], visual_hashes[right])
            minimum = min(minimum, distance)
            if distance < 5:
                pairs.append({"left": left, "right": right, "dhash_distance": distance})
    if pairs:
        failures.append({"id": family, "error": "near_duplicate_visuals", "pairs": pairs})
    return verified, failures, minimum


def contact_sheet(manifest: dict[str, Any], output: Path, columns: int) -> None:
    tile_w, tile_h, label_h = 320, 180, 36
    records = manifest["records"]
    rows = (len(records) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_w, rows * (tile_h + label_h)), "#081713")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=14)
    for index, record in enumerate(records):
        identifier = record.get("program_id") or record.get("id")
        derivatives = record.get("outputs") or record.get("derivatives") or []
        preferred = next(item for item in derivatives if item["width"] == 640 and item["path"].endswith(".jpg"))
        with Image.open(ROOT / preferred["path"]) as image:
            tile = image.convert("RGB").resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        x = (index % columns) * tile_w
        y = (index // columns) * (tile_h + label_h)
        sheet.paste(tile, (x, y))
        draw.text((x + 8, y + tile_h + 9), identifier[:42], fill="#eff8f4", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "JPEG", quality=90, optimize=True)


def main() -> int:
    argparse.ArgumentParser().parse_args()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        provider = load_manifest(PROVIDER_MANIFEST, "glp-pass2-provider-review-image-manifest-v1", 35)
        product = load_manifest(PRODUCT_MANIFEST, "glp-pass2-product-comparison-image-manifest-v1", 9)
        provider_ok, provider_fail, provider_min = audit_records(provider, "provider")
        product_ok, product_fail, product_min = audit_records(product, "product")
        contact_sheet(provider, REPORT_DIR / "provider-contact-sheet.jpg", 5)
        contact_sheet(product, REPORT_DIR / "product-contact-sheet.jpg", 3)
        failures = provider_fail + product_fail
        report = {
            "schema": "glp-pass2-provider-product-image-audit-v1",
            "status": "PASS" if not failures else "BLOCKED",
            "provider": {"expected": 35, "verified": len(provider_ok), "minimum_dhash_distance": provider_min},
            "product": {"expected": 9, "verified": len(product_ok), "minimum_dhash_distance": product_min},
            "failures": failures,
            "contact_sheets": [str(REPORT_DIR / "provider-contact-sheet.jpg"), str(REPORT_DIR / "product-contact-sheet.jpg")],
        }
    except Exception as error:
        report = {"schema": "glp-pass2-provider-product-image-audit-v1", "status": "BLOCKED", "failures": [{"error": str(error)}]}
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
