#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/affiliate-held-link-manifest.json"
LEDGER = ROOT / "data/program-content-ledger.json"
ELIGIBILITY = ROOT / "data/program-page-eligibility.json"
WORKER = ROOT / "src/worker.mjs"
GO_ADAPTER = ROOT / "functions/go/[program].js"
REPORT = Path("/home/ubuntu/business/reports/glp-clinic-scout/operator-national-wow-20260723")
ACTIVATION = ROOT / "data/affiliate-activation-selection.json"
SOURCES = {
    "program_content_ledger": LEDGER,
    "program_page_eligibility": ELIGIBILITY,
    "money_page_specs": ROOT / "data/money-page-specs.json",
    "approved_registry": Path("/home/ubuntu/business/reports/glp-clinic-scout/phase0-20260722/approved-programs-registry.bridge.json"),
    "sheet_readback": REPORT / "continuation-final-sheet-verification.json",
    "duplicate_receipt": REPORT / "duplicate-route-final-20260723/final-sheet-readback.json",
}
EXPECTED_ALIASES = {
    "healthrx": "healthrx-affiliate-program",
    "try-ageless": "ageless",
    "wellorithm": "wellorithm-glp-1",
}
EXPECTED_RELATIONSHIPS = {
    "found-health": ("Katalys", "1162", 110, "approved_active_not_wired", "hold_compounded"),
    "yourera-program": ("Katalys", "1602", 131, "approved_active_tracking_ready", "hold_missing_evidence"),
    "trimi-glp-1": ("Katalys", "1614", 132, "applied_approved_not_wired", "hold_compounded"),
    "shedrx": ("Katalys", "1516", 323, "approved_active_tracking_ready", "hold_compounded"),
    "gala-health": ("Katalys", "1576", 88, "applied_approved_not_wired", "hold_compounded"),
    "oak-weight-loss-program": ("Katalys", "1581", 102, "approved_active_tracking_ready", "hold_missing_evidence"),
    "healthrx": ("Katalys", "1630", 87, "approved_active_not_wired", "hold_compounded"),
    "try-ageless": ("Katalys", "1538", 94, "approved_active_tracking_ready", "hold_compounded"),
    "wellorithm": ("Katalys", "1565", 97, "approved_active_tracking_ready", "hold_compounded"),
    "enhance-md": ("Katalys", "738", 98, "approved_active_tracking_ready", "hold_compounded"),
    "synergy-rx": ("Katalys", "1520", 103, "applied_approved_not_wired", "hold_compounded"),
    "care-bare-rx-glp1": ("Katalys", "1519", 105, "applied_approved_not_wired", "hold_compounded"),
    "serena-health": ("Awin", "128203", 242, "approved_active_tracking_ready", "hold_compounded"),
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    data = json.loads(MANIFEST.read_text())
    activation = json.loads(ACTIVATION.read_text())
    failures: list[str] = []
    programs = data.get("programs", [])
    ids = [row.get("content_program_id") for row in programs]
    selected = {row.get("program_id"): row for row in activation.get("programs", [])}
    expected = set(selected)
    if len(programs) != 13 or len(set(ids)) != 13 or set(ids) != set(expected):
        failures.append("accepted_13_program_identity_mismatch")
    eligibility = json.loads(ELIGIBILITY.read_text()).get("programs", [])
    if data.get("eligibility_registry_count") != 15 or len(eligibility) != 15:
        failures.append("eligibility_registry_count_not_15")
    if data.get("state") != "LIVE_TRANSPARENT_DIRECT" or data.get("live_program_count") != 13:
        failures.append("transparent_direct_state_invalid")
    if data.get("tracking_urls_included") is not False or data.get("go_routes_modified") != 0:
        failures.append("held_runtime_boundary_invalid")
    if data.get("source_sha256") != activation.get("source_snapshot_sha256"):
        failures.append("activation_source_hash_mismatch")
    if activation.get("status") != "APPROVED_FOR_TRANSPARENT_DIRECT_BUILD" or activation.get("program_count") != 13 or activation.get("go_route_program_count") != 0:
        failures.append("activation_selection_invalid")
    if data.get("alias_map") != EXPECTED_ALIASES:
        failures.append("alias_map_mismatch")
    tuples: set[tuple[str, str, int]] = set()
    for row in programs:
        program_id = row.get("content_program_id")
        selected_row = selected.get(program_id, {})
        if any(row.get(key) is not False for key in ("tracking_url_included", "go_route_wired", "constructor_verified", "advertiser_permission_verified")):
            failures.append(f"runtime_boundary_open:{program_id}")
        if row.get("activation_state") != "LIVE_TRANSPARENT_DIRECT" or row.get("link_mode") != "transparent_direct" or row.get("promotion_authorized") is not True or row.get("live_link_allowed") is not True:
            failures.append(f"transparent_direct_program_invalid:{program_id}")
        if row.get("operator_selection_receipt_sha256") != activation.get("operator_gate_receipt_sha256"):
            failures.append(f"operator_receipt_mismatch:{program_id}")
        if not selected_row or selected_row.get("link_mode") != "transparent_direct" or not isinstance(selected_row.get("tracking_link_sha256"), str) or len(selected_row["tracking_link_sha256"]) != 64:
            failures.append(f"selection_row_invalid:{program_id}")
        if selected_row and (selected_row.get("network") != row.get("network") or selected_row.get("network_program_id") != row.get("immutable_network_program_id") or selected_row.get("sheet_row") != row.get("canonical_sheet_row")):
            failures.append(f"selection_relationship_mismatch:{program_id}")
        host = row.get("destination_host", "")
        if "://" in host or "/" in host or "?" in host or "#" in host:
            failures.append(f"non_host_destination:{program_id}")
        relationship = (
            row.get("network"),
            row.get("immutable_network_program_id"),
            row.get("canonical_sheet_row"),
            row.get("relationship_source_status"),
            row.get("compliance_gate"),
        )
        if relationship != EXPECTED_RELATIONSHIPS.get(program_id):
            failures.append(f"relationship_mismatch:{program_id}")
        key = relationship[:3]
        if key in tuples:
            failures.append(f"duplicate_relationship_tuple:{program_id}")
        tuples.add(key)
        if row.get("approval_confirmed") is not True:
            failures.append(f"approval_state_invalid:{program_id}")
    excluded = {row.get("worker_program_id") for row in data.get("excluded_worker_programs", [])}
    if excluded != {"mademed", "telos-rx"}:
        failures.append("excluded_worker_set_mismatch")
    protected = data.get("protected_runtime_sha256", {})
    if protected.get("functions/go/[program].js") != sha(GO_ADAPTER) or sha(GO_ADAPTER) != "bc4d2b2cbaa3a060605713970c4fe5cbb91d608d47b8352cbdadc10484fcfcef":
        failures.append("go_adapter_hash_mismatch")
    if protected.get("src/worker.mjs") != sha(WORKER) or sha(WORKER) != "56b80af723f370912deff76c3c5a7c21ef1f706639bd79767b22f34fd54de88a":
        failures.append("worker_hash_mismatch")
    rulings = data.get("duplicate_and_distinct_rulings", {})
    if rulings.get("awin_78548") != "duplicate_do_not_use" or rulings.get("katalys_1372") != "distinct_pending" or rulings.get("katalys_1530") != "distinct_pending":
        failures.append("duplicate_or_distinct_ruling_mismatch")
    receipt = {
        "status": "PASS" if not failures else "FAIL",
        "accepted_programs": len(programs),
        "eligibility_registry_programs": data.get("eligibility_registry_count"),
        "excluded_worker_programs": sorted(excluded),
        "state": data.get("state"),
        "link_mode": "transparent_direct",
        "tracking_urls_included": data.get("tracking_urls_included"),
        "live_programs": data.get("live_program_count"),
        "go_routes_modified": data.get("go_routes_modified"),
        "affiliate_worker_sha256": sha(WORKER),
        "go_adapter_sha256": sha(GO_ADAPTER),
        "failures": failures,
    }
    print(json.dumps(receipt, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
