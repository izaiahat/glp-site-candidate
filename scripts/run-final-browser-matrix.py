#!/usr/bin/env python3
"""Run the final Chromium/WebKit matrix and bind its receipt to public bytes."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
REPORT_DIR = Path("/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723")
LOG = REPORT_DIR / "flagship-playwright-final.log"
RECEIPT = REPORT_DIR / "flagship-playwright-final.json"
EXPECTED_PASS = 370


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix().encode()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    before = tree_sha256(PUBLIC)
    command = ["npx", "playwright", "test", "--reporter=line"]
    with LOG.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "CI": "1"},
        )
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            log.write(line)
        exit_code = process.wait()
    after = tree_sha256(PUBLIC)
    text = LOG.read_text(encoding="utf-8", errors="replace")
    matches = [int(value) for value in re.findall(r"(?:^|\n)\s*(\d+) passed\b", text)]
    passed = matches[-1] if matches else 0
    status = "pass" if exit_code == 0 and before == after and passed == EXPECTED_PASS and not re.search(r"(?:^|\n)\s*\d+ failed\b", text) else "fail"
    receipt = {
        "status": status,
        "command": " ".join(command),
        "expected_passed": EXPECTED_PASS,
        "observed_passed": passed,
        "exit_code": exit_code,
        "public_tree_sha256_before": before,
        "public_tree_sha256_after": after,
        "public_tree_unchanged": before == after,
        "log_path": str(LOG),
        "log_sha256": sha256_file(LOG),
        "completed_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "effects": {"deployment": False, "indexation": False, "affiliate_activation": False, "email_send": False, "spend_usd": 0},
    }
    RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, separators=(",", ":")))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
