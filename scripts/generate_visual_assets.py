#!/usr/bin/env python3
"""Bounded four-asset Higgsfield batch; never retries a submitted generation."""
from __future__ import annotations

import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUSINESS = Path("/home/ubuntu/business")
BRIEF = BUSINESS / "reports/glp-clinic-scout/phase1-playbook-20260722/visual-asset-brief.json"
HF = Path("/home/ubuntu/.hermes/node/bin/higgsfield")
SOURCE = ROOT / "assets/source"
RECEIPTS = BUSINESS / "reports/glp-clinic-scout/phase1-playbook-20260722/higgsfield-receipts"
SOURCE.mkdir(parents=True, exist_ok=True)
RECEIPTS.mkdir(parents=True, exist_ok=True)


def walk_urls(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from walk_urls(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_urls(item)
    elif isinstance(value, str) and value.startswith("https://"):
        yield value


def parse_json(text: str):
    decoder = json.JSONDecoder()
    for i, char in enumerate(text):
        if char not in "[{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
            return obj
        except json.JSONDecodeError:
            pass
    raise ValueError("provider_output_json_not_found")


def download_image(urls, destination: Path):
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Clinic-Scout-staging-asset-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=120) as response:
                content_type = response.headers.get("content-type", "")
                data = response.read()
            if content_type.startswith("image/") and len(data) > 10_000:
                destination.write_bytes(data)
                return {"source_url": url, "content_type": content_type, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        except Exception:
            continue
    raise RuntimeError("no_downloadable_image_result")


def main():
    brief = json.loads(BRIEF.read_text())
    completed = []
    for asset in brief["assets"]:
        slug = asset["slug"]
        raw_path = RECEIPTS / f"{slug}.provider-output.txt"
        image_path = SOURCE / f"{slug}.source"
        meta_path = RECEIPTS / f"{slug}.json"
        if meta_path.exists() and image_path.exists():
            completed.append(json.loads(meta_path.read_text()))
            continue
        command = [
            str(HF), "generate", "create", brief["model"],
            "--prompt", asset["prompt"],
            "--aspect_ratio", brief["aspect_ratio"],
            "--resolution", brief["resolution"],
            "--quality", brief["quality"],
            "--wait", "--wait-timeout", "30m", "--json",
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=2400)
        raw_path.write_text(result.stdout + "\nSTDERR:\n" + result.stderr)
        if result.returncode != 0:
            raise RuntimeError(f"generation_failed_without_retry:{slug}:exit_{result.returncode}")
        payload = parse_json(result.stdout)
        urls = list(dict.fromkeys(walk_urls(payload)))
        receipt = {"slug": slug, "model": brief["model"], "alt": asset["alt"], "truthfulness": brief["truthfulness"], "generation_exit": 0}
        receipt.update(download_image(urls, image_path))
        meta_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        completed.append(receipt)
        print(json.dumps({"slug": slug, "status": "PASS", "bytes": receipt["bytes"]}, sort_keys=True), flush=True)
    summary = {"status": "PASS", "asset_count": len(completed), "assets": completed}
    (RECEIPTS / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "asset_count": len(completed)}, sort_keys=True))


if __name__ == "__main__":
    main()
