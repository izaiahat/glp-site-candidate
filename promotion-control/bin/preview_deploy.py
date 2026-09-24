#!/usr/bin/env python3
"""Fail-closed Cloudflare Pages preview carrier. Plans only unless explicitly applied."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
from pathlib import Path

from control_lib import (
    CANDIDATE, PINNED_WRANGLER, PREVIEW_BRANCH, PROJECT, RELEASE_MANIFEST,
    SURFACE_MANIFEST, all_effects_held, load_json, sha_file, validate_branch,
    verify_self_hash, verify_surface,
)


def build_command() -> list[str]:
    validate_branch(PREVIEW_BRANCH)
    return [
        "npx", "--yes", f"wrangler@{PINNED_WRANGLER}", "pages", "deploy", "public",
        "--project-name", PROJECT, "--branch", PREVIEW_BRANCH, "--commit-dirty=true",
        "--commit-message", "GLP P1 hash-bound held preview",
    ]


def verify_release() -> dict:
    release = load_json(RELEASE_MANIFEST)
    verify_self_hash(release)
    surface = load_json(SURFACE_MANIFEST)
    verify_surface(surface)
    candidate = release.get("candidate", {})
    if candidate.get("root") != str(CANDIDATE) or candidate.get("deploy_root") != str(CANDIDATE / "public"):
        raise ValueError("release_root_binding_invalid")
    if candidate.get("tree_sha256") != surface.get("tree_sha256") or candidate.get("surface_manifest_sha256") != sha_file(SURFACE_MANIFEST):
        raise ValueError("release_surface_binding_invalid")
    preview = release.get("preview", {})
    validate_branch(preview.get("branch", ""))
    if preview.get("project") != PROJECT or preview.get("environment") != "preview" or preview.get("main_allowed") is not False:
        raise ValueError("release_preview_binding_invalid")
    if not all_effects_held(release.get("effects", {})):
        raise ValueError("release_effects_open")
    return release


def verify_authorization(path: Path, release: dict) -> None:
    auth = load_json(path)
    expected_command = f"DEPLOY GLP-P1 PREVIEW {release['manifest_sha256']}"
    required = {
        "schema": "glp-p1-preview-deploy-authorization-v1", "authorized": True,
        "command": expected_command, "project": PROJECT, "branch": PREVIEW_BRANCH,
        "candidate_root": str(CANDIDATE), "candidate_tree_sha256": release["candidate"]["tree_sha256"],
        "release_manifest_sha256": release["manifest_sha256"], "consumed": False,
    }
    for key, value in required.items():
        if auth.get(key) != value:
            raise ValueError(f"preview_authorization_invalid:{key}")
    expiry = dt.datetime.fromisoformat(str(auth.get("expires_at_utc", "")).replace("Z", "+00:00"))
    if expiry <= dt.datetime.now(dt.timezone.utc):
        raise ValueError("preview_authorization_expired")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="perform one provider preview deployment")
    parser.add_argument("--authorization", type=Path, help="exact fresh preview authorization JSON")
    args = parser.parse_args(argv)
    release = verify_release()
    command = build_command()
    plan = {
        "status": "HELD_PLAN_ONLY" if not args.apply else "APPLY_REQUESTED",
        "project": PROJECT, "branch": PREVIEW_BRANCH, "working_directory": str(CANDIDATE),
        "deploy_root": str(CANDIDATE / "public"), "candidate_tree_sha256": release["candidate"]["tree_sha256"],
        "release_manifest_sha256": release["manifest_sha256"], "command": command,
        "provider_called": False,
    }
    if not args.apply:
        print(json.dumps(plan, sort_keys=True))
        return 0
    if args.authorization is None:
        raise ValueError("preview_authorization_required")
    verify_authorization(args.authorization, release)
    completed = subprocess.run(command, cwd=CANDIDATE, check=False, text=True, capture_output=True)
    print(completed.stdout, end="")
    if completed.returncode:
        print(completed.stderr, end="")
        raise SystemExit(completed.returncode)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
