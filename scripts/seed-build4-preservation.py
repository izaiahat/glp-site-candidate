#!/usr/bin/env python3
"""Seed interruption-safe Build 4 predecessor bytes from a lineage-matched release."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

CANDIDATE = Path("/home/ubuntu/business/site-system/flagship-v2/candidates/glp-visual-ultracode-20260821")
DESTINATION = CANDIDATE / "artifacts/build4-preservation"
RECEIPT = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/PASS2-BUILD4-PRESERVATION-SEED-20260825.json")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(payload).hexdigest()


def copy_file(source: Path, relative: str) -> dict:
    destination = DESTINATION / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    shutil.copy2(source, destination)
    if sha(source) != sha(destination):
        raise RuntimeError(f"preservation_copy_hash_mismatch:{relative}")
    return {"path": relative, "bytes": destination.stat().st_size, "sha256": sha(destination)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    source = Path(args.source).resolve()
    source_price = source / "public/glp-1-price-index/index.html"
    source_manifest_path = source / "artifacts/ops/price-index-manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text())
    tracker = json.loads((CANDIDATE / "data/price-tracker.json").read_text())
    if sha(source_price) != source_manifest.get("html_sha256"):
        raise RuntimeError("source_price_index_pair_hash_mismatch")
    if canonical_sha(tracker) != source_manifest.get("tracker_payload_sha256"):
        raise RuntimeError("source_price_index_tracker_lineage_mismatch")
    expected_sources = source_manifest.get("source_hashes") or {}
    for relative, key in [
        ("data/original-data-study.json", "original_data_study_sha256"),
        ("data/program-content-ledger.json", "program_content_ledger_sha256"),
    ]:
        if sha(CANDIDATE / relative) != expected_sources.get(key):
            raise RuntimeError(f"source_price_index_input_lineage_mismatch:{key}")
    required = {
        "glp-1-price-index/index.html": source_price,
        "ops/price-index-manifest.json": source_manifest_path,
        "ops/wave4-deal-ingestion-manifest.json": source / "artifacts/ops/wave4-deal-ingestion-manifest.json",
        "guides/mounjaro-coupon/index.html": source / "public/guides/mounjaro-coupon/index.html",
        "_headers": source / "public/_headers",
    }
    records = []
    for relative, source_path in required.items():
        if not source_path.is_file():
            raise RuntimeError(f"preservation_source_missing:{source_path}")
        records.append(copy_file(source_path, relative))
    google_root = source / "public/google-ads-api"
    google_files = sorted(path for path in google_root.rglob("*") if path.is_file())
    if not google_files:
        raise RuntimeError("preservation_google_ads_tree_empty")
    for source_path in google_files:
        relative = Path("google-ads-api") / source_path.relative_to(google_root)
        records.append(copy_file(source_path, str(relative)))
    receipt = {
        "schema": "glp-pass2-build4-preservation-seed-v1",
        "status": "PASS",
        "candidate": str(CANDIDATE),
        "source": str(source),
        "source_price_index_latest_observed_on": source_manifest.get("latest_observed_on"),
        "source_price_index_html_sha256": source_manifest.get("html_sha256"),
        "source_tracker_lineage_sha256": source_manifest.get("tracker_payload_sha256"),
        "records": records,
        "zero_deploys": True,
        "zero_provider_writes": True,
    }
    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    RECEIPT.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "records": len(records), "receipt": str(RECEIPT)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
