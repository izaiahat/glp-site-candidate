#!/usr/bin/env python3
"""Seal the local-only successor artifacts. No network or provider operation exists here."""
from __future__ import annotations

import json
from pathlib import Path

from control_lib import (
    BASELINE, BASELINE_MANIFEST, CANARY_SUCCESSOR, CANDIDATE, DIFF_MANIFEST,
    PREVIEW_BRANCH, PREVIEW_RECEIPT, PRIOR_PRODUCTION_DEPLOYMENT_ID, PROJECT,
    RELEASE_MANIFEST, REPORT, ROLLBACK_MANIFEST, SURFACE_MANIFEST,
    all_effects_held, canonical_tree_sha, load_json, object_sha, require_isolated_paths,
    sha_file, surface_snapshot, write_json,
)

REPAIR_FILES = ["src/worker.mjs", "tests/playbook.test.mjs", "data/canonical-click-token-spec.json"]
ALLOWED_CHANGED_BASELINE = set(REPAIR_FILES + ["package.json", "playwright.config.mjs", "data/affiliate-held-link-manifest.json", "scripts/validate-affiliate-held-manifest.py"])
OLD_INTEGRATION = Path("/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723/CANARY-INTEGRATION-MANIFEST.json")
ACCEPTED_HANDOFF = Path("/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723/CANARY-P1-ACCEPTED-HANDOFF-20260724.json")
ACCEPTED_CANARY = Path("/home/ubuntu/business/site-system/flagship-v2/staging/glp-consumer-additive-canary-20260723")


def source_maps() -> tuple[dict, dict]:
    baseline_manifest = load_json(BASELINE_MANIFEST)
    if baseline_manifest.get("accepted_public_tree", {}).get("sha256") != "1a706e89dbc6a4ef46bab8ee9fe98fdb8e2ba65f488bb7b291e82e07e1df0be5":
        raise ValueError("baseline_authority_hash_invalid")
    before = {
        row["path"]: {key: row[key] for key in ("bytes", "mode", "sha256")}
        for row in baseline_manifest.get("entries", [])
        if row.get("kind") == "file" and "test-results" not in Path(row["path"]).parts
    }
    surface = surface_snapshot(CANDIDATE)
    after = {row["path"]: {key: row[key] for key in ("bytes", "mode", "sha256")} for row in surface["files"]}
    return before, after


def verify_repair() -> None:
    total = 0
    for rel in REPAIR_FILES:
        old = (BASELINE / rel).read_bytes()
        new = (CANDIDATE / rel).read_bytes()
        count = old.count(b"CLICK_MAP")
        total += count
        if count < 1 or new != old.replace(b"CLICK_MAP", b"GLP_DB"):
            raise ValueError(f"non_exact_binding_repair:{rel}")
    if total != 10:
        raise ValueError(f"repair_occurrence_count:{total}")
    for rel in REPAIR_FILES:
        if b"CLICK_MAP" in (CANDIDATE / rel).read_bytes():
            raise ValueError(f"legacy_binding_remains:{rel}")


def main() -> int:
    require_isolated_paths()
    verify_repair()
    public_sha, public_files = canonical_tree_sha(CANDIDATE / "public")
    if (public_sha, public_files) != ("1a706e89dbc6a4ef46bab8ee9fe98fdb8e2ba65f488bb7b291e82e07e1df0be5", 406):
        raise ValueError("accepted_public_bytes_changed")

    surface = surface_snapshot(CANDIDATE)
    write_json(SURFACE_MANIFEST, surface)
    before, after = source_maps()
    changed = sorted(path for path in before.keys() & after.keys() if before[path] != after[path])
    added = sorted(after.keys() - before.keys())
    deleted = sorted(before.keys() - after.keys())
    if set(changed) != ALLOWED_CHANGED_BASELINE:
        raise ValueError(f"unexpected_baseline_changes:{changed}")
    if deleted:
        raise ValueError(f"baseline_file_deleted:{deleted}")
    if any(not path.startswith("promotion-control/") for path in added):
        raise ValueError(f"added_file_outside_control_plane:{added}")
    diff = {
        "schema": "glp-baseline-to-candidate-diff-v1",
        "baseline_root": str(BASELINE),
        "candidate_root": str(CANDIDATE),
        "baseline_byte_manifest": {"path": str(BASELINE_MANIFEST), "sha256": sha_file(BASELINE_MANIFEST)},
        "candidate_tree_sha256": surface["tree_sha256"],
        "changed": [{"path": path, "before": before[path], "after": after[path]} for path in changed],
        "added": [{"path": path, "after": after[path]} for path in added],
        "deleted": [],
        "binding_repair": {"from": "CLICK_MAP", "to": "GLP_DB", "occurrences": 10, "files": REPAIR_FILES, "exact_token_replacement_only_in_repair_files": True},
    }
    diff["manifest_sha256"] = object_sha(diff)
    write_json(DIFF_MANIFEST, diff)

    effects = {
        "deployment": False, "production_promotion": False, "canary_promotion": False,
        "dns": False, "indexation": False, "affiliate_activation": False,
        "capture_activation": False, "analytics_mutation": False, "email": False,
        "provider_sharing": False, "optimizer": False, "spend_usd": 0,
    }
    if not all_effects_held(effects):
        raise ValueError("effects_not_held")

    rollback_command = (
        f"python3 {CANDIDATE}/promotion-control/bin/rollback.py "
        f"--manifest {ROLLBACK_MANIFEST} --authorization <operator-authorization.json> --apply"
    )
    rollback = {
        "schema": "glp-pages-rollback-manifest-v2",
        "status": "HELD_OPERATOR_AUTHORIZATION_REQUIRED",
        "project": PROJECT,
        "production_branch": "main",
        "prior_production_deployment_id": PRIOR_PRODUCTION_DEPLOYMENT_ID,
        "candidate_tree_sha256": surface["tree_sha256"],
        "automatic_rollback_authorized": False,
        "operator_authorization_required": True,
        "rollback_executed": False,
        "authorization_grammar": f"ROLLBACK GLP-P1 {surface['tree_sha256']} TO {PRIOR_PRODUCTION_DEPLOYMENT_ID}",
        "rollback_command": rollback_command,
        "api_operation": "POST /accounts/{account_id}/pages/projects/glp-clinic-scout/deployments/{prior_deployment_id}/rollback",
        "effects": effects,
    }
    rollback["manifest_sha256"] = object_sha(rollback)
    write_json(ROLLBACK_MANIFEST, rollback)

    old = load_json(OLD_INTEGRATION)
    accepted = load_json(ACCEPTED_HANDOFF)
    canary_sha, canary_files = canonical_tree_sha(ACCEPTED_CANARY / "public")
    canary_successor = {
        "schema": "glp-additive-noindex-canary-handoff-v4-successor",
        "status": "SUCCESSOR_REPAIR_PREPARED_HELD_FRESH_ACCEPTANCE_REQUIRED",
        "supersedes_stale_control_only": {"path": str(OLD_INTEGRATION), "sha256": sha_file(OLD_INTEGRATION), "prior_status": old.get("status")},
        "accepted_canary_bytes_unchanged": {"root": str(ACCEPTED_CANARY), "public_tree_sha256": canary_sha, "public_files": canary_files},
        "predecessor_acceptance": {"path": str(ACCEPTED_HANDOFF), "sha256": sha_file(ACCEPTED_HANDOFF), "status": accepted.get("true_fable", {}).get("status"), "acceptance_message_id": accepted.get("true_fable", {}).get("acceptance_message_id"), "scope": "predecessor bytes only; not successor acceptance"},
        "successor_candidate": {"root": str(CANDIDATE), "tree_sha256": surface["tree_sha256"], "binding": "GLP_DB", "repair": "CLICK_MAP->GLP_DB"},
        "successor_true_fable_acceptance_receipt": None,
        "operator_promotion_receipt": None,
        "canary_promotion_authorized": False,
        "production_promotion_authorized": False,
        "effects": effects,
    }
    canary_successor["manifest_sha256"] = object_sha(canary_successor)
    write_json(CANARY_SUCCESSOR, canary_successor)

    functions_sha, functions_files = canonical_tree_sha(CANDIDATE / "functions")
    release = {
        "schema": "glp-additive-production-release-manifest-v1",
        "status": "HELD_PREVIEW_ACCEPTANCE_AND_OPERATOR_AUTHORITY",
        "release_mode": "additive_preserve_existing_production_routes_functions_bindings",
        "candidate": {
            "root": str(CANDIDATE), "deploy_root": str(CANDIDATE / "public"),
            "tree_sha256": surface["tree_sha256"], "surface_manifest_path": str(SURFACE_MANIFEST),
            "surface_manifest_sha256": sha_file(SURFACE_MANIFEST), "public_tree_sha256": public_sha,
            "public_files": public_files, "functions_tree_sha256": functions_sha,
            "functions_files": functions_files, "binding": "GLP_DB",
        },
        "diff": {"path": str(DIFF_MANIFEST), "sha256": sha_file(DIFF_MANIFEST), "changed": len(changed), "added": len(added), "deleted": 0},
        "prior_production": {"project": PROJECT, "branch": "main", "deployment_id": PRIOR_PRODUCTION_DEPLOYMENT_ID},
        "preview": {"project": PROJECT, "branch": PREVIEW_BRANCH, "environment": "preview", "apply_default": False, "main_allowed": False},
        "preview_receipt": {"required": True, "path": str(PREVIEW_RECEIPT), "sha256": None, "status": "MISSING_NOT_DEPLOYED"},
        "rollback": {"path": str(ROLLBACK_MANIFEST), "sha256": sha_file(ROLLBACK_MANIFEST), "automatic_authorized": False, "executed": False},
        "successor_acceptance": {"required": True, "receipt": None, "predecessor_acceptance_does_not_transfer": True},
        "effects": effects,
        "eligibility": {
            "production": {"eligible": False, "reasons": ["preview receipt absent", "fresh successor acceptance absent", "operator promotion receipt absent"]},
            "affiliate_runtime": {"eligible": False, "live_programs": 0, "gate": "held", "operator_selection_receipts": 0},
            "capture_runtime": {"eligible": False, "gate": "held", "lead_capture_mode": "not production_operator_approved"},
        },
        "promotion_grammar": "PROMOTE GLP-P1 <release-manifest-sha256>",
        "operator_promotion_receipt": None,
        "external_acceptance_claimed": False,
    }
    release["manifest_sha256"] = object_sha(release)
    write_json(RELEASE_MANIFEST, release)
    print(json.dumps({
        "status": "PASS_LOCAL_PREPARATION_HELD", "candidate_tree_sha256": surface["tree_sha256"],
        "public_tree_sha256": public_sha, "diff_sha256": sha_file(DIFF_MANIFEST),
        "rollback_sha256": sha_file(ROLLBACK_MANIFEST), "release_manifest_sha256": release["manifest_sha256"],
        "canary_successor_sha256": sha_file(CANARY_SUCCESSOR), "effects": effects,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
