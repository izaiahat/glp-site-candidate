#!/usr/bin/env python3
from __future__ import annotations

if __name__ == "__main__":
    raise SystemExit("DEPRECATED_FAIL_CLOSED: use /home/ubuntu/business/scripts/validate_glp_phase2_batch2_content.py --prepare; accepted packet releases are write-once")

import hashlib
import json
import re
import zipfile
from pathlib import Path

BUSINESS = Path("/home/ubuntu/business")
STAGING = BUSINESS / "site-system/flagship-v2/staging/glp-consumer-playbook-phase1-20260722"
REPORT = BUSINESS / "reports/glp-clinic-scout/phase1-playbook-20260722"
OUT = REPORT / "fable-packets"
FIXED_ZIP_TIME = (2026, 7, 23, 0, 0, 0)

COMMON = [
    REPORT / "authority-snapshot.json",
    REPORT / "supersession.md",
    REPORT / "visual-asset-manifest.json",
    STAGING / "public/batch-gate.json",
    STAGING / "public/build-report.json",
]

PACKETS = {
    "affiliate-foundation": [
        STAGING / "data/money-page-specs.json",
        STAGING / "data/program-page-eligibility.json",
        STAGING / "src/money-page.mjs",
        STAGING / "src/network-constructors.mjs",
        STAGING / "src/worker.mjs",
        STAGING / "src/analytics.mjs",
        STAGING / "src/schema.mjs",
        STAGING / "src/economics.mjs",
        STAGING / "functions/go/[program].js",
        STAGING / "migrations/001_click_map.sql",
        STAGING / "public/best/online-glp-1-providers/index.html",
        STAGING / "public/best/glp-1-providers-with-insurance-support/index.html",
        STAGING / "public/how-we-rate/index.html",
        STAGING / "public/how-we-make-money/index.html",
        REPORT / "cross-device-renders/chromium-money-1440.png",
        REPORT / "cross-device-renders/chromium-money-390.png",
    ],
    "lead-email": [
        STAGING / "data/quiz-config.json",
        STAGING / "data/resend-email-machine.json",
        STAGING / "src/quiz.mjs",
        STAGING / "src/lead-capture.mjs",
        STAGING / "src/resend-email-machine.mjs",
        STAGING / "src/consent-runtime.mjs",
        STAGING / "src/legal-pages.mjs",
        STAGING / "functions/api/leads.js",
        STAGING / "functions/api/resend-webhook.js",
        STAGING / "functions/unsubscribe.js",
        STAGING / "workers/email-scheduler.mjs",
        STAGING / "migrations/002_email_machine.sql",
        STAGING / "public/quiz/provider-fit/index.html",
        STAGING / "public/resend-email-machine.json",
        REPORT / "resend-implementation-research.md",
        REPORT / "cross-device-renders/chromium-quiz-1440.png",
        REPORT / "cross-device-renders/chromium-quiz-390.png",
    ],
    "blog-system": [
        STAGING / "data/blog/content-templates.json",
        STAGING / "data/blog/held-drafts.json",
        STAGING / "data/blog/keyword-ownership-map.json",
        STAGING / "data/blog/brief-template.json",
        STAGING / "data/blog/brief-sample-held.json",
        STAGING / "src/blog-system.mjs",
        STAGING / "public/blog-system.json",
        STAGING / "public/guides/how-to-compare-online-glp-1-providers/index.html",
        STAGING / "public/coverage/bcbs-glp-1-california/index.html",
        STAGING / "public/coverage/kaiser-glp-1-oregon/index.html",
        STAGING / "public/best/glp-1-insurance-support-california/index.html",
        REPORT / "cross-device-renders/chromium-blog-1440.png",
        REPORT / "cross-device-renders/chromium-blog-390.png",
    ],
    "type5-directory": [
        STAGING / "data/directory/npi-seeds.json",
        STAGING / "src/directory.mjs",
        STAGING / "functions/api/directory-corrections.js",
        STAGING / "public/clinics/portland-or/index.html",
        STAGING / "public/clinics/san-diego-ca/index.html",
        STAGING / "public/clinics/sacramento-ca/index.html",
        REPORT / "npi-seed-research.md",
        REPORT / "cross-device-renders/chromium-directory-1440.png",
        REPORT / "cross-device-renders/chromium-directory-390.png",
    ],
}

SECRET_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "aws_access_key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "stripe_live_key": re.compile(rb"sk_live_[A-Za-z0-9]{16,}"),
    "resend_key": re.compile(rb"\bre_[A-Za-z0-9_-]{20,}"),
    "webhook_secret": re.compile(rb"\bwhsec_[A-Za-z0-9+/=_-]{20,}"),
    "database_uri": re.compile(rb"(?:postgres(?:ql)?|mysql)://[^\s\"']+:[^\s\"']+@"),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def logical_path(path: Path) -> str:
    return path.relative_to(BUSINESS).as_posix()


def validate_payload(path: Path, data: bytes) -> None:
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".avif", ".webp"}:
        return
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(data):
            raise RuntimeError(f"secret_pattern:{label}:{logical_path(path)}")
    if (b"Notes / " + b"Blockers") in data or (b"Notes" + b"/Blocker") in data:
        raise RuntimeError(f"private_sheet_field:{logical_path(path)}")


def zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info


def build_packet(name: str, paths: list[Path]) -> dict:
    files = []
    payloads = []
    for path in [*COMMON, *paths]:
        if not path.is_file():
            raise FileNotFoundError(logical_path(path))
        data = path.read_bytes()
        validate_payload(path, data)
        logical = logical_path(path)
        files.append({"path": logical, "bytes": len(data), "sha256": sha256(data)})
        payloads.append((logical, data))
    files.sort(key=lambda item: item["path"])
    payloads.sort(key=lambda item: item[0])
    packet_manifest = {
        "schema": "clinic-scout-fable-packet-v1",
        "packet": name,
        "status": "STAGING_LINK_DARK_HELD",
        "authority_addenda": ["A", "B", "C", "D", "E", "F", "G"],
        "release_authorized": False,
        "email_sends_authorized": False,
        "provider_sharing_authorized": False,
        "affiliate_activation_authorized": False,
        "indexing_authorized": False,
        "files": files,
    }
    manifest_bytes = (json.dumps(packet_manifest, indent=2, sort_keys=True) + "\n").encode()
    zip_path = OUT / f"glp-clinic-scout-phase1-{name}-STAGING-HELD.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(zip_info("PACKET-MANIFEST.json"), manifest_bytes)
        for logical, data in payloads:
            archive.writestr(zip_info(logical), data)
    zip_data = zip_path.read_bytes()
    return {
        "packet": name,
        "path": logical_path(zip_path),
        "bytes": len(zip_data),
        "sha256": sha256(zip_data),
        "file_count": len(files) + 1,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.zip"):
        old.unlink()
    packets = [build_packet(name, paths) for name, paths in PACKETS.items()]
    receipt = {
        "schema": "clinic-scout-fable-packet-set-v1",
        "status": "PASS_SANITIZED_STAGING_HELD",
        "packet_count": len(packets),
        "packets": packets,
        "delivery_authorized_to": "discord:#fable bridge acceptance only",
        "go_live_authorized": False,
    }
    receipt_path = REPORT / "fable-packet-manifest.json"
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "pass", "packet_count": len(packets), "receipt": logical_path(receipt_path)}))


if __name__ == "__main__":
    main()
