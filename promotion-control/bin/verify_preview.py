#!/usr/bin/env python3
"""GET/HEAD-only post-preview verifier with deterministic offline fixture mode."""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from control_lib import (
    CANDIDATE, PREVIEW_BRANCH, PROJECT, RELEASE_MANIFEST, REPORT,
    load_json, sha_bytes, verify_self_hash, write_json,
)

ROUTES = ["/", "/best/online-glp-1-providers/"]


def validate_deployment(value: dict, release: dict) -> None:
    expected = {"project": PROJECT, "branch": PREVIEW_BRANCH, "environment": "preview"}
    for key, item in expected.items():
        if value.get(key) != item:
            raise ValueError(f"deployment_binding_invalid:{key}")
    parsed = urlparse(value.get("preview_url", ""))
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(f".{PROJECT}.pages.dev"):
        raise ValueError("preview_url_not_immutable_pages_url")
    if not value.get("deployment_id"):
        raise ValueError("deployment_id_missing")


def live_responses(base: str) -> dict:
    responses = {}
    for route in ROUTES:
        url = base.rstrip("/") + route
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": "glp-p1-readonly-verifier/1"})
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            headers = {key.lower(): value for key, value in response.headers.items()}
            responses[route] = {"status": response.status, "headers": headers, "body": body}
        head = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "glp-p1-readonly-verifier/1"})
        with urllib.request.urlopen(head, timeout=20) as response:
            if response.status != responses[route]["status"]:
                raise ValueError(f"get_head_status_drift:{route}")
    return responses


def fixture_responses(fixture: dict) -> dict:
    return {
        route: {"status": row["status"], "headers": {k.lower(): v for k, v in row.get("headers", {}).items()}, "body": row.get("body_utf8", "").encode("utf-8")}
        for route, row in fixture["responses"].items()
    }


def build_receipt(deployment: dict, responses: dict, production_unchanged: bool, mode: str, release: dict) -> dict:
    validate_deployment(deployment, release)
    failures = []
    for route in ROUTES:
        row = responses.get(route)
        if not row or row.get("status") != 200:
            failures.append(f"route_status:{route}")
            continue
        robots = row.get("headers", {}).get("x-robots-tag", "").lower()
        if "noindex" not in robots:
            failures.append(f"x_robots_missing:{route}")
    if responses.get("/best/online-glp-1-providers/", {}).get("headers", {}).get("cache-control", "").lower() != "no-store":
        failures.append("canary_cache_control_not_no_store")
    if not production_unchanged:
        failures.append("production_baseline_changed")
    return {
        "schema": "glp-post-preview-readonly-receipt-v1",
        "status": "PASS_READ_ONLY" if not failures else "FAIL",
        "verifier_mode": mode,
        "deployment": {
            **deployment,
            "release_manifest_sha256": release["manifest_sha256"],
            "candidate_tree_sha256": release["candidate"]["tree_sha256"],
        },
        "bindings": {"required_runtime_binding": "GLP_DB", "binding_repair": "CLICK_MAP->GLP_DB"},
        "route_statuses": {route: row["status"] for route, row in responses.items()},
        "response_hashes": {route: sha_bytes(row["body"]) for route, row in responses.items()},
        "production_baseline_unchanged": production_unchanged,
        "effects": {"methods": ["GET", "HEAD"], "deployment": False, "dns": False, "indexation": False, "affiliate_activation": False, "capture_activation": False, "analytics_mutation": False, "email": False, "optimizer": False, "spend_usd": 0},
        "failures": failures,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--fixture", type=Path)
    modes.add_argument("--live-read-only", action="store_true")
    parser.add_argument("--deployment", type=Path, help="provider deployment identity JSON for live read-only mode")
    parser.add_argument("--output", type=Path, default=REPORT / "post-preview-receipt.json")
    args = parser.parse_args(argv)
    release = load_json(RELEASE_MANIFEST)
    verify_self_hash(release)
    if args.fixture:
        fixture = load_json(args.fixture)
        deployment = fixture["deployment"]
        responses = fixture_responses(fixture)
        unchanged = fixture.get("production_baseline_unchanged") is True
        mode = "offline_fixture"
    else:
        if args.deployment is None:
            raise ValueError("deployment_identity_required")
        deployment_doc = load_json(args.deployment)
        deployment = deployment_doc["deployment"]
        validate_deployment(deployment, release)
        responses = live_responses(deployment["preview_url"])
        unchanged = deployment_doc.get("production_baseline_unchanged") is True
        mode = "live_read_only_get_head"
    receipt = build_receipt(deployment, responses, unchanged, mode, release)
    write_json(args.output, receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output), "failures": receipt["failures"]}, sort_keys=True))
    return 0 if receipt["status"] == "PASS_READ_ONLY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
