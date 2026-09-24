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
STAGING = BUSINESS / "site-system/flagship-v2/staging/glp-consumer-playbook-phase2-20260723"
REPORT = BUSINESS / "reports/glp-clinic-scout/phase2-content-20260723"
OUT = REPORT / "fable-packets"
FIXED_ZIP_TIME = (2026, 7, 23, 5, 0, 0)

SECRET_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "aws_access_key": re.compile(rb"AKIA[0-9A-Z]{16}"),
    "stripe_live_key": re.compile(rb"sk_live_[A-Za-z0-9]{16,}"),
    "resend_key": re.compile(rb"\bre_[A-Za-z0-9_-]{20,}"),
    "webhook_secret": re.compile(rb"\bwhsec_[A-Za-z0-9+/=_-]{20,}"),
    "database_uri": re.compile(rb"(?:postgres(?:ql)?|mysql)://[^\s\"']+:[^\s\"']+@"),
    "active_go_anchor": re.compile(rb"href\s*=\s*[\"']/go/", re.I),
    "sponsored_anchor": re.compile(rb"rel\s*=\s*[\"'][^\"']*sponsored", re.I),
}


def load(relative: str) -> dict:
    return json.loads((STAGING / relative).read_text())


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def logical(path: Path) -> str:
    return path.relative_to(BUSINESS).as_posix()


def page_output(url_path: str) -> Path:
    return STAGING / "public" / url_path.strip("/") / "index.html"


def validate_payload(path: Path, data: bytes) -> None:
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".avif", ".webp"}:
        return
    for label, pattern in SECRET_PATTERNS.items():
        if label in {"active_go_anchor", "sponsored_anchor"} and path.suffix.lower() != ".html":
            continue
        if pattern.search(data):
            raise RuntimeError(f"forbidden_pattern:{label}:{logical(path)}")
    lowered = data.lower()
    if b"notes / blockers" in lowered or b"notes/blocker" in lowered:
        raise RuntimeError(f"private_sheet_field:{logical(path)}")


def zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info


def build_packet(name: str, paths: list[Path]) -> dict:
    files: list[dict] = []
    payloads: list[tuple[str, bytes]] = []
    for path in sorted(set(paths), key=lambda item: logical(item)):
        if not path.is_file():
            raise FileNotFoundError(logical(path))
        data = path.read_bytes()
        validate_payload(path, data)
        item_path = logical(path)
        files.append({"path": item_path, "bytes": len(data), "sha256": sha256(data)})
        payloads.append((item_path, data))
    packet_manifest = {
        "schema": "glp-clinic-scout-phase2-fable-packet-v1",
        "packet": name,
        "status": "PASS_STAGING_LINK_DARK_NOINDEX",
        "release_authorized": False,
        "affiliate_activation_authorized": False,
        "indexing_authorized": False,
        "deployment_authorized": False,
        "email_sends_authorized": False,
        "provider_sharing_authorized": False,
        "tracking_link_requests": 0,
        "spend_usd": 0,
        "files": files,
    }
    manifest_bytes = (json.dumps(packet_manifest, indent=2, sort_keys=True) + "\n").encode()
    zip_path = OUT / f"glp-clinic-scout-phase2-{name}-STAGING-LINK-DARK.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(zip_info("PACKET-MANIFEST.json"), manifest_bytes)
        for item_path, data in payloads:
            archive.writestr(zip_info(item_path), data)
    zip_data = zip_path.read_bytes()
    return {
        "packet": name,
        "path": logical(zip_path),
        "bytes": len(zip_data),
        "sha256": sha256(zip_data),
        "file_count": len(files) + 1,
    }


def main() -> None:
    acceptance = REPORT / "acceptance.json"
    if not acceptance.is_file() or json.loads(acceptance.read_text()).get("status") != "PASS_STAGING_LINK_DARK":
        raise RuntimeError("phase2_acceptance_missing_or_not_pass")

    money = load("data/money-page-specs.json")
    blog = load("data/blog/content-batch.json")
    directory = load("data/directory/npi-city-batch.json")

    common = [
        REPORT / "authority-snapshot.json",
        REPORT / "research/provider-source-ledger.json",
        REPORT / "research/provider-claim-extract-snapshots.json",
        REPORT / "research/primary-source-ledger.json",
        REPORT / "acceptance.json",
        REPORT / "cross-device-playwright.json",
        REPORT / "cwv-receipt.json",
        STAGING / "public/build-report.json",
        STAGING / "public/batch-gate.json",
    ]
    packets = {
        "money-pages": [
            *common,
            STAGING / "data/program-content-ledger.json",
            STAGING / "data/money-page-specs.json",
            STAGING / "src/money-page.mjs",
            *[page_output(item["path"]) for item in money["pages"]],
            REPORT / "cross-device-renders/chromium-money-1440.png",
            REPORT / "cross-device-renders/chromium-money-390.png",
        ],
        "blog-batch": [
            *common,
            STAGING / "data/program-content-ledger.json",
            STAGING / "data/blog/content-batch.json",
            STAGING / "data/blog/keyword-ownership-map.json",
            STAGING / "src/blog-system.mjs",
            *[page_output(item["canonical_path"]) for item in blog["articles"]],
            REPORT / "cross-device-renders/chromium-blog-1440.png",
            REPORT / "cross-device-renders/chromium-blog-390.png",
        ],
        "directory-batch": [
            *common,
            STAGING / "data/directory/npi-city-batch.json",
            STAGING / "src/directory.mjs",
            *[page_output(f"/clinics/{item['slug']}/") for item in directory["cities"]],
            REPORT / "cross-device-renders/chromium-directory-1440.png",
            REPORT / "cross-device-renders/chromium-directory-390.png",
        ],
        "quiz": [
            *common,
            STAGING / "data/quiz-config.json",
            STAGING / "src/quiz.mjs",
            STAGING / "public/quiz/provider-fit/index.html",
            REPORT / "cross-device-renders/chromium-quiz-1440.png",
            REPORT / "cross-device-renders/chromium-quiz-390.png",
        ],
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.zip"):
        old.unlink()
    built = [build_packet(name, paths) for name, paths in packets.items()]
    receipt = {
        "schema": "glp-clinic-scout-phase2-fable-packet-set-v1",
        "status": "PASS_SANITIZED_STAGING_LINK_DARK",
        "packet_count": len(built),
        "packets": built,
        "delivery_authorized_to": "discord:#fable bridge acceptance only",
        "go_live_authorized": False,
    }
    receipt_path = REPORT / "fable-packet-manifest.json"
    receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "pass", "packet_count": len(built), "receipt": logical(receipt_path)}, sort_keys=True))


if __name__ == "__main__":
    main()
