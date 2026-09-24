#!/usr/bin/env python3
"""Shared deterministic primitives for the held GLP P1 promotion control plane."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any

BASELINE = Path("/home/ubuntu/business/site-system/flagship-v2/staging/glp-consumer-national-wow-20260723")
CANDIDATE = Path("/home/ubuntu/business/site-system/flagship-v2/staging/glp-consumer-national-wow-p1-promotion-candidate-20260724")
REPORT = Path("/home/ubuntu/business/reports/glp-clinic-scout/national-wow-p1-promotion-candidate-20260724")
BASELINE_MANIFEST = REPORT / "baseline-byte-manifest.json"
SURFACE_MANIFEST = REPORT / "candidate-release-surface-manifest.json"
DIFF_MANIFEST = REPORT / "baseline-to-candidate-diff.json"
ROLLBACK_MANIFEST = REPORT / "rollback-manifest.json"
RELEASE_MANIFEST = REPORT / "production-release-manifest.json"
CANARY_SUCCESSOR = REPORT / "CANARY-INTEGRATION-MANIFEST.v4-successor.json"
PREVIEW_RECEIPT = REPORT / "post-preview-receipt.json"
PROJECT = "glp-clinic-scout"
PREVIEW_BRANCH = "glp-go1-20260724"
ACCOUNT_ID = "f860943dff399ffb1db0a28dcd3dadfd"
PRIOR_PRODUCTION_DEPLOYMENT_ID = "812a7120-cb7c-4b28-8c2e-6dc11579dc80"
PINNED_WRANGLER = "4.102.0"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
EXCLUDED_PARTS = {".git", ".wrangler", "node_modules", "__pycache__", ".pytest_cache", "test-results"}


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def object_sha(value: Any, *, omit: tuple[str, ...] = ("manifest_sha256",)) -> str:
    if isinstance(value, dict):
        value = {key: item for key, item in value.items() if key not in omit}
    return sha_bytes(canonical_bytes(value))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def included(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return not any(part in EXCLUDED_PARTS for part in rel.parts) and not path.name.endswith(".pyc")


def file_rows(root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted((item for item in root.rglob("*") if item.is_file() or item.is_symlink()), key=lambda p: p.relative_to(root).as_posix()):
        if not included(path, root):
            continue
        if path.is_symlink():
            raise ValueError(f"symlink_not_allowed:{path}")
        rel = path.relative_to(root).as_posix()
        rows.append({
            "path": rel,
            "bytes": path.stat().st_size,
            "mode": f"{stat.S_IMODE(path.stat().st_mode):04o}",
            "sha256": sha_file(path),
        })
    return rows


def canonical_tree_sha(root: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    files = sorted(path for path in root.rglob("*") if path.is_file() and included(path, root))
    for path in files:
        rel = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(rel).to_bytes(4, "big"))
        digest.update(rel)
        digest.update(bytes.fromhex(sha_file(path)))
    return digest.hexdigest(), len(files)


def surface_snapshot(root: Path = CANDIDATE) -> dict[str, Any]:
    rows = file_rows(root)
    tree_sha, count = canonical_tree_sha(root)
    manifest = {
        "schema": "glp-candidate-release-surface-manifest-v1",
        "root": str(root),
        "algorithm": "sha256(len4be(relative_path)+relative_path+file_sha256_bytes); excludes declared volatile paths",
        "exclusions": sorted(EXCLUDED_PARTS) + ["*.pyc"],
        "tree_sha256": tree_sha,
        "file_count": count,
        "files": rows,
    }
    manifest["manifest_sha256"] = object_sha(manifest)
    return manifest


def verify_surface(manifest: dict[str, Any], root: Path = CANDIDATE) -> None:
    if manifest.get("schema") != "glp-candidate-release-surface-manifest-v1":
        raise ValueError("surface_schema_invalid")
    if manifest.get("root") != str(root):
        raise ValueError("surface_root_invalid")
    if manifest.get("manifest_sha256") != object_sha(manifest):
        raise ValueError("surface_manifest_hash_invalid")
    actual = surface_snapshot(root)
    for key in ("tree_sha256", "file_count", "files", "exclusions"):
        if actual.get(key) != manifest.get(key):
            raise ValueError(f"surface_drift:{key}")


def verify_self_hash(manifest: dict[str, Any]) -> None:
    value = manifest.get("manifest_sha256")
    if not isinstance(value, str) or not HEX64.fullmatch(value) or value != object_sha(manifest):
        raise ValueError("manifest_self_hash_invalid")


def all_effects_held(effects: dict[str, Any]) -> bool:
    return bool(effects) and all(value is False or value == 0 for value in effects.values())


def validate_branch(branch: str) -> None:
    if branch == "main" or branch != PREVIEW_BRANCH or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", branch):
        raise ValueError("preview_branch_rejected")


def require_isolated_paths() -> None:
    if CANDIDATE == BASELINE or BASELINE in CANDIDATE.parents or CANDIDATE in BASELINE.parents:
        raise ValueError("candidate_not_isolated")
    if not CANDIDATE.is_dir() or not BASELINE.is_dir() or not REPORT.is_dir():
        raise ValueError("required_root_missing")
    if os.path.realpath(CANDIDATE) == os.path.realpath(BASELINE):
        raise ValueError("candidate_resolves_to_baseline")
