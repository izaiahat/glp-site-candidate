#!/usr/bin/env python3
"""Operator-gated Cloudflare Pages rollback command. Held unless --apply plus exact authority."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import urllib.request
from pathlib import Path

from control_lib import ACCOUNT_ID, PRIOR_PRODUCTION_DEPLOYMENT_ID, PROJECT, load_json, verify_self_hash


def validate_authorization(auth: dict, manifest: dict) -> None:
    required = {
        "schema": "glp-p1-rollback-authorization-v1", "authorized": True,
        "command": manifest["authorization_grammar"], "project": PROJECT,
        "prior_production_deployment_id": PRIOR_PRODUCTION_DEPLOYMENT_ID,
        "candidate_tree_sha256": manifest["candidate_tree_sha256"],
        "rollback_manifest_sha256": manifest["manifest_sha256"], "consumed": False,
    }
    for key, value in required.items():
        if auth.get(key) != value:
            raise ValueError(f"rollback_authorization_invalid:{key}")
    expiry = dt.datetime.fromisoformat(str(auth.get("expires_at_utc", "")).replace("Z", "+00:00"))
    if expiry <= dt.datetime.now(dt.timezone.utc):
        raise ValueError("rollback_authorization_expired")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--authorization", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    manifest = load_json(args.manifest)
    verify_self_hash(manifest)
    if manifest.get("automatic_rollback_authorized") is not False or manifest.get("rollback_executed") is not False or manifest.get("operator_authorization_required") is not True:
        raise ValueError("rollback_manifest_not_held")
    if not args.apply:
        print(json.dumps({"status": "HELD_NO_EXECUTION", "provider_called": False, "authorization_required": True, "command": manifest["authorization_grammar"]}, sort_keys=True))
        return 0
    if args.authorization is None:
        raise ValueError("rollback_authorization_required")
    validate_authorization(load_json(args.authorization), manifest)
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        raise ValueError("cloudflare_api_token_required")
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT}/deployments/{PRIOR_PRODUCTION_DEPLOYMENT_ID}/rollback"
    request = urllib.request.Request(endpoint, method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, data=b"{}")
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")
    parsed = json.loads(payload)
    if response.status // 100 != 2 or parsed.get("success") is not True:
        raise RuntimeError("rollback_provider_rejected")
    print(json.dumps({"status": "ROLLBACK_PROVIDER_ACCEPTED_REQUIRES_READBACK", "http_status": response.status, "target": PRIOR_PRODUCTION_DEPLOYMENT_ID}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
