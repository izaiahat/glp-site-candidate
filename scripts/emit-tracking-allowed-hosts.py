#!/usr/bin/env python3
"""Project the CANONICAL affiliate rails onto this release's programs.

WHY THIS EXISTS (2026-08-20, Blocker F)
---------------------------------------
`src/provider-review.mjs` used to carry `DIRECT_TRACKING_HOSTS`, a frozen
per-NETWORK literal of tracking hosts. It was a third copy of rail knowledge
that `scripts/glp_affiliate_link_rails.py` already owns, and it had no
`Trackdesk` key at all, so Nu Image Medical — whose link the worker and the
builder both resolved correctly to `nuimagemedical.com` — was refused by the one
component that decides whether the monetized CTA is emitted at all:

    review_direct_link_host_invalid:nu-image-medical-review

The renderer is pure JS and runs at build time, so it cannot import the python
rails module. This script closes the gap in the honest direction: it RESOLVES
each program's allowed hosts through the canonical module and writes the answer
into the build inputs, where the renderer reads it. No rail knowledge is copied;
only the resolved result is. The build-staging entry regenerates it before
loading inputs and checks it again after rendering on every `npm run build`.

WHAT IT DOES NOT DO
-------------------
It invents nothing and loosens nothing. Every host it emits comes from
`glp_affiliate_link_rails.program_allowed_hosts`, which is the same resolution
the wire-in-ready gate and the incremental builder already run:

  * a rail with FIXED hosts (Awin, Katalys, CJ) answers for itself;
  * every other rail resolves through `spec_allowed_host` — a declared
    `tracking_host` first, else the program's independently authored
    `official_url` — and a declared host on a merchant-hosted rail must sit
    inside that official domain or the module refuses by name.

A program whose hosts cannot be resolved is NOT emitted with an empty list: the
script fails, loudly and by name, because the renderer's host check is a
monetization safety gate and an unresolvable program must never render a link.

It never fetches anything.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
# The original canonical resolver is snapshotted byte-for-byte into the mirror.
# An explicitly supplied module still wins for the host's registered build lane.
DEFAULT_RAILS = Path(
    os.environ.get("GLP_AFFILIATE_RAILS_MODULE",
                   str(ROOT / "scripts/glp_affiliate_link_rails.py"))
)
OUTPUT = ROOT / "data/tracking-allowed-hosts.json"
SCHEMA = "glp.tracking_allowed_hosts.v1"


def load_rails(path: Path):
    """Import the canonical rails module WITHOUT writing bytecode into its tree.

    Reading another tree's module must be a pure read. The incremental builder's
    integrity guard caught exactly this on 2026-08-20 (a stray
    `scripts/__pycache__/*.pyc` failed the build), and on a sealed release the
    write would hit 0444 instead.
    """
    if not path.is_file():
        raise SystemExit(f"rails_module_missing:{path}")
    if "glp_affiliate_link_rails" in sys.modules:
        return sys.modules["glp_affiliate_link_rails"]
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("glp_affiliate_link_rails", path)
        if spec is None or spec.loader is None:
            raise SystemExit(f"rails_module_unloadable:{path}")
        module = importlib.util.module_from_spec(spec)
        # Registered under its REAL name before exec: the module's frozen
        # dataclasses resolve their own `__module__` through sys.modules, and an
        # anonymous alias would both crash that and mint a second rail identity.
        sys.modules["glp_affiliate_link_rails"] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop("glp_affiliate_link_rails", None)
            raise
        return module
    finally:
        sys.dont_write_bytecode = previous


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def monetized_programs(root: Path) -> dict[str, dict]:
    """Every program whose CTA a renderer will try to emit, with its spec fields.

    Two sources, because two renderers ask:
      * `data/provider-page-contracts.json` — the fast-path review lane, which
        also carries each program's authored `official_url`;
      * `data/money-page-specs.json` — the comparison rows, which carry the
        surface writer's derived `affiliate_tracking_host`.
    A program in both merges: the contract's authored official URL plus whichever
    tracking host was declared. Merging is what lets the canonical module CHECK a
    declared host against an independently authored one.
    """
    programs: dict[str, dict] = {}

    contracts = read_json(root / "data/provider-page-contracts.json")
    for contract in contracts.get("providers") or []:
        network = (contract.get("network_contract") or {}).get("network")
        row = contract.get("row_contract") or {}
        if not network or not row.get("affiliate_href"):
            continue
        if row.get("live_link_allowed") is not True or row.get("promotion_authorized") is not True:
            continue
        entry = programs.setdefault(str(contract["program_id"]), {})
        entry["network"] = network
        entry["official_url"] = contract.get("official_url")
        if contract.get("tracking_host"):
            entry["tracking_host"] = contract["tracking_host"]

    money = read_json(root / "data/money-page-specs.json")
    for page in money.get("pages") or []:
        for row in page.get("rows") or []:
            network = row.get("affiliate_network")
            if not network or not row.get("affiliate_href"):
                continue
            if row.get("live_link_allowed") is not True or row.get("promotion_authorized") is not True:
                continue
            entry = programs.setdefault(str(row["program_id"]), {})
            entry.setdefault("network", network)
            if row.get("official_url"):
                entry.setdefault("official_url", row["official_url"])
            if row.get("affiliate_tracking_host"):
                entry.setdefault("tracking_host", row["affiliate_tracking_host"])
    wire_path = root / "data/affiliate-wire-in-approvals.json"
    if wire_path.exists():
        for approval in read_json(wire_path).get("programs") or []:
            program_id = approval.get("existing_release_alias")
            if program_id in programs and approval.get("approval_state") == "approved_active" and approval.get("wire_in_ready") is True:
                programs[program_id]["network"] = approval["network"]

    approved_path = root / "data/approved-program-registry.json"
    if approved_path.exists():
        for approval in read_json(approved_path).get("programs") or []:
            # The approved eMed directory link is not a scored money-page row.
            if approval.get("registry_id") != "partnerize-1011l6645":
                continue
            href = (approval.get("tracking") or {}).get("provider_issued_url")
            if approval.get("enumeration_class") != "provider_joined_or_approved_exact_id" or not href:
                continue
            programs[approval["registry_id"]] = {
                "network": approval["network"],
                "tracking_host": urlparse(href).hostname,
            }
    # The receipted /go successor supersedes frozen money-row rails. Consume
    # the SAME validating loader as the renderer (terms/hash/promotion checks),
    # not a second JSON reader that could accept a tampered selection.
    projection = subprocess.run([
        "node", "--input-type=module", "-e",
        "import {loadGoSelection} from './src/go-runtime-selection.mjs';"
        "console.log(JSON.stringify(Object.values(loadGoSelection()?.programs || {})"
        ".filter(r=>r.disposition==='ADOPT')));"
    ], cwd=root, check=True, capture_output=True, text=True)
    for row in json.loads(projection.stdout):
        href = urlparse(row["issued_link"])
        if href.scheme != "https" or not href.hostname:
            raise SystemExit(f"selected_rail_href_invalid:{row['render_id']}")
        programs[row["render_id"]] = {
            "network": row["network"], "tracking_host": href.hostname,
            "official_url": programs.get(row["render_id"], {}).get("official_url"),
            "selection_sha256": sha_file(root / "data/go-selection-receipt.json"),
        }
    return programs


def build_document(root: Path, rails_path: Path) -> dict:
    rails = load_rails(rails_path)
    programs = monetized_programs(root)
    resolved: dict[str, dict] = {}
    for program_id in sorted(programs):
        spec = programs[program_id]
        network = spec["network"]
        rail = rails.rail_for(network)
        if rail is None:
            raise SystemExit(f"network_not_supported:{program_id}:{network}")
        try:
            hosts = rails.program_allowed_hosts(network, spec)
        except rails.RailError as exc:
            raise SystemExit(f"tracking_allowed_hosts_unresolved:{program_id}:{exc}") from None
        if not hosts:
            raise SystemExit(f"tracking_allowed_hosts_empty:{program_id}")
        resolved[program_id] = {
            "allowed_hosts": sorted(hosts),
            "host_class": rail.host_class,
            "authority_network": network,
            "network": rail.network,
            "network_aliases": sorted(set([network, rail.network, *rail.aliases])),
            "selection_sha256": spec.get("selection_sha256"),
            "resolution": "rail_fixed_hosts" if rail.hosts else (
                "declared_tracking_host" if spec.get("tracking_host") else "official_url_derived"
            ),
        }
    # Directory-only ClickDealer captures have no generic constructor rail.
    # Reuse the renderer's exact capture + promotion verifier; never infer a
    # network-wide allowlist, mutate issuer URLs, or print private links.
    if os.environ.get("GLP_PRIVATE_APPROVED_REGISTRY"):
        projection = subprocess.run([
            "node", "--input-type=module", "-e",
            "import {loadApprovedDirectoryRegistry} from './src/private-approved-directory.mjs';"
            "console.log(JSON.stringify(loadApprovedDirectoryRegistry().approved_directory_programs.map(r=>({"
            "id:r.registry_id,network:r.network,host:new URL(r.tracking.provider_issued_url).hostname,"
            "sha256:r.tracking.issued_link_sha256}))));"
        ], cwd=root, check=True, capture_output=True, text=True)
        for row in json.loads(projection.stdout):
            if row["id"] in resolved:
                raise SystemExit(f"directory_rail_identity_collision:{row['id']}")
            resolved[row["id"]] = {
                "allowed_hosts": [row["host"]], "network": row["network"],
                "host_class": "tracking_domain", "resolution": "exact_issuer_capture",
                "issued_link_sha256": row["sha256"],
            }
    # Render slugs and canonical registry IDs name the same bound program.
    for row in read_json(root / "data/program-registry.json").get("programs", []):
        alias = row.get("review_slug")
        canonical = row["program_id"]
        if alias and alias in resolved and canonical != alias:
            if canonical in resolved and resolved[canonical] != resolved[alias]:
                raise SystemExit(f"rail_registry_alias_collision:{canonical}")
            resolved[canonical] = resolved[alias]
    return {
        "generated_by": "scripts/emit-tracking-allowed-hosts.py",
        "inputs": ["data/provider-page-contracts.json", "data/money-page-specs.json", "data/affiliate-wire-in-approvals.json", "data/approved-program-registry.json", "data/go-selection-receipt.json", "data/go-terms-review-ledger.json", "data/program-registry.json"],
        "note": ("Derived, never hand-edited. Regenerated by `npm run build` from "
                 "glp_affiliate_link_rails.program_allowed_hosts — the same resolver "
                 "the wire-in-ready gate and the incremental builder use."),
        "program_count": len(resolved),
        "programs": resolved,
        "rails_module": {"path": str(rails_path), "sha256": sha_file(rails_path)},
        "directory_capture_validator": ({
            "path": "src/private-approved-directory.mjs",
            "sha256": sha_file(root / "src/private-approved-directory.mjs"),
            "scope": "four exact captured directory links; no constructor or network-wide grant",
        } if os.environ.get("GLP_PRIVATE_APPROVED_REGISTRY") else None),
        "schema": SCHEMA,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--rails-module", default=str(DEFAULT_RAILS))
    parser.add_argument("--output", default=None)
    parser.add_argument("--check", action="store_true",
                        help="fail if the on-disk document differs from a fresh derivation")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output = Path(args.output) if args.output else root / "data/tracking-allowed-hosts.json"
    document = build_document(root, Path(args.rails_module).resolve())
    # Deterministic bytes: sorted keys, no timestamp. A build that changes nothing
    # must leave this file byte-identical, or every release would carry a spurious
    # diff and the byte-twin comparison would have nothing to say.
    rendered = json.dumps(document, indent=2, sort_keys=True) + "\n"

    if args.check:
        if not output.is_file():
            print(f"tracking_allowed_hosts_missing:{output}", file=sys.stderr)
            return 1
        if output.read_text(encoding="utf-8") != rendered:
            print(f"tracking_allowed_hosts_stale:{output}", file=sys.stderr)
            return 1
        print(json.dumps({"status": "PASS", "program_count": document["program_count"]}))
        return 0

    if output.is_file() and output.read_text(encoding="utf-8") == rendered:
        print(json.dumps({"status": "PASS_UNCHANGED", "program_count": document["program_count"]}))
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    temporary.write_text(rendered, encoding="utf-8")
    os.replace(temporary, output)
    print(json.dumps({"status": "PASS_WRITTEN", "program_count": document["program_count"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
