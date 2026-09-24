#!/usr/bin/env python3
"""Validate the additive release manifest and exact promotion grammar without deploying."""
from __future__ import annotations

import argparse
import json

from control_lib import (
    DIFF_MANIFEST, RELEASE_MANIFEST, ROLLBACK_MANIFEST, SURFACE_MANIFEST,
    all_effects_held, load_json, sha_file, verify_self_hash, verify_surface,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", help="an exact future operator command; held manifests always reject")
    args = parser.parse_args(argv)
    release = load_json(RELEASE_MANIFEST)
    verify_self_hash(release)
    verify_surface(load_json(SURFACE_MANIFEST))
    if release.get("diff", {}).get("sha256") != sha_file(DIFF_MANIFEST):
        raise ValueError("diff_hash_invalid")
    if release.get("rollback", {}).get("sha256") != sha_file(ROLLBACK_MANIFEST):
        raise ValueError("rollback_hash_invalid")
    if not all_effects_held(release.get("effects", {})):
        raise ValueError("effects_not_held")
    expected = f"PROMOTE GLP-P1 {release['manifest_sha256']}"
    if args.command is not None:
        if args.command != expected:
            raise ValueError("promotion_command_mismatch")
        if release.get("status") != "ELIGIBLE_FOR_EXACT_OPERATOR_COMMAND" or not release.get("eligibility", {}).get("production", {}).get("eligible"):
            raise ValueError("production_manifest_held")
    print(json.dumps({"status": "PASS_HELD" if release["status"].startswith("HELD_") else "PASS_ELIGIBLE", "expected_future_command": expected, "external_effect": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
