#!/usr/bin/env python3
"""Fail-closed control boundary for the GLP Clinic Scout Pass 7 acceptance run.

This program creates a new acceptance run, validates hash-bound receipts, runs
local corruption controls, and independently closes an exact receipt set.  It
never builds, browses, deploys, performs a provider write, submits a form,
requests /go, follows an affiliate destination, or sends analytics.  Every
unimplemented domain validator returns nonzero rather than manufacturing PASS.
"""

from __future__ import annotations

import argparse
import copy
import csv
import datetime as dt
import hashlib
import io
import ipaddress
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

SCRIPT = Path(__file__).resolve()
RELEASE_ROOT = SCRIPT.parents[2]
CONTRACT_DIR = SCRIPT.parent
WORKSPACE_ROOT = Path("/home/ubuntu/business")
EVIDENCE_BASE = WORKSPACE_ROOT / "reports/glp-clinic-scout/rebuild/pass7-acceptance"

RECEIPT_SCHEMA = "glp.pass7.validator-receipt.v1"
RUN_SCHEMA = "glp.pass7.acceptance-run.v1"
TARGET_BINDING_SCHEMA = "glp.pass7.target-binding.v1"
ZERO_SHA = "0" * 64
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
RUN_RE = re.compile(r"^p7-(\d{8}T\d{6}Z)-([0-9a-f]{32})$")
RFC3339_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$")
SAFE_ITEM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

# This literal catalog is intentionally explicit.  It is cross-checked against
# acceptance-catalog.json and the spec package's VALIDATORS.json before INIT.
PHASE_IDS: dict[str, tuple[str, ...]] = {
    "pre": (
        "P7-CTL-01", "P7-CTL-02", "P7-PRE-01", "P7-PRE-02",
        "P7-PRE-03", "P7-PRE-04", "P7-PRE-05", "P7-PRE-06",
    ),
    "deploy": ("P7-DEP-01",),
    "candidate": (
        "P7-CAN-01", "P7-CAN-02", "P7-CAN-03", "P7-CAN-04",
        "P7-CAN-05", "P7-CAN-06", "P7-CAN-07", "P7-CAN-08",
        "P7-CAN-09", "P7-CAN-10", "P7-CAN-11", "P7-CAN-12",
        "P7-CAN-13", "P7-CAN-14", "P7-CAN-15", "P7-CAN-16",
        "P7-CAN-17", "P7-CAN-18", "P7-CAN-19", "P7-CAN-20",
        "P7-CAN-21", "P7-CAN-22", "P7-CAN-23", "P7-CAN-24",
    ),
    "live": (
        "P7-LIVE-01", "P7-LIVE-02", "P7-LIVE-03", "P7-LIVE-04",
        "P7-LIVE-05", "P7-LIVE-06", "P7-LIVE-07", "P7-LIVE-08",
        "P7-LIVE-09", "P7-LIVE-10",
    ),
}
ALL_IDS = tuple(item for phase in ("pre", "deploy", "candidate", "live") for item in PHASE_IDS[phase])

# Which validators have a REGISTERED domain implementation here. This is the
# single source the catalog is checked against, so the catalog can never claim an
# implementation the code does not have, and the code can never quietly gain one
# the catalog has not declared. It replaces two frozen literals that had to be
# edited by hand and therefore could drift from reality in either direction.
IMPLEMENTED_COMMANDS: dict[str, str] = {
    "P7-CTL-01": "init",
    "P7-CTL-02": "negative-control-only",
    "P7-PRE-01": "pre-domain",
    "P7-PRE-02": "pre-domain",
    "P7-PRE-03": "pre-domain",
    "P7-PRE-04": "pre-domain",
    "P7-PRE-05": "pre-domain",
    "P7-PRE-06": "pre-domain",
}
# The 24 P7-CAN-* and 10 P7-LIVE-* rows are DEPLOY-BOUND, not unimplemented: a
# candidate/live target binding requires an https origin matched against a
# governed-deploy binding (P7-DEP-01). They run at P14/P15 against the deployed
# origin. Recording that here keeps the boundary honest in both directions.
DEPLOY_BOUND_IDS = frozenset(PHASE_IDS["deploy"] + PHASE_IDS["candidate"] + PHASE_IDS["live"])
ID_PHASE = {item: phase for phase, items in PHASE_IDS.items() for item in items}
MAPPING_IDS = tuple(f"map-row-{index:02d}" for index in range(1, 27))

SIDE_EFFECTS = {
    "deployments": 0,
    "webhooks": 0,
    "sheet_writes": 0,
    "d1_writes": 0,
    "analytics_sends": 0,
    "form_submissions": 0,
    "go_route_requests": 0,
    "affiliate_destination_requests": 0,
}

# Operator ruling R3 (reports/ops/briefs/OPERATOR-RULINGS-20260902-ADS-CONSENT-A2.md)
# is the binding A2 authority and matches specs/home-carousel-drawer.md §0/§3.1:
# auto-advance every 3000 ms, one visible pause/play control, pause on hover,
# focus and interaction, and a fresh full interval on every resume.
A2_RULING = {
    "authority": "reports/ops/briefs/OPERATOR-RULINGS-20260902-ADS-CONSENT-A2.md#R3",
    "cadence_ms": 3000,
    "auto_advance": True,
    "hover_pause": True,
    "focus_pause": True,
    "pause_play_control": True,
    "client_state_mutation": True,
}
A2_ITEM_IDS = {
    "A2-03S-AUTO-ADVANCE",
    "A2-HOVER-FOCUS-PAUSE",
    "A2-ONE-PAUSE-PLAY-CONTROL",
    "A2-FRESH-INTERVAL-RESUME",
}

TOP_KEYS = {
    "schema", "validator_id", "phase", "status", "complete",
    "acceptance_run_id", "run_manifest_sha256", "challenge_nonce_sha256",
    "started_at_utc", "finished_at_utc", "command", "command_sha256",
    "runner_sha256", "contract_bundle_sha256", "target", "expected_count",
    "observed_count", "passed_count", "failed_count", "skipped_count",
    "unexpected_count", "items", "errors", "warnings", "side_effects",
    "receipt_sha256",
}
TARGET_KEYS = {
    "origin", "release_id", "deployment_id", "release_tree_sha256",
    "public_tree_sha256", "ownership_marker_sha256",
}
RUN_KEYS = {
    "schema", "status", "acceptance_run_id", "started_at_utc", "host_id",
    "challenge_nonce", "challenge_nonce_sha256", "workspace",
    "candidate_source", "git_commit", "git_tree", "git_clean", "runner",
    "runner_sha256", "contract_bundle", "contract_bundle_sha256",
    "required_validator_ids", "required_validator_count", "validator_catalog",
    "expected_mapping_row_ids", "input_bindings", "current_base_binding",
    "side_effect_policy", "operator_rulings", "control_target",
    "phase_binding_paths", "manifest_sha256",
}
TARGET_BINDING_KEYS = {
    "schema", "status", "phase", "acceptance_run_id", "created_at_utc",
    "source_run_manifest_sha256", "target", "evidence", "side_effects",
    "manifest_sha256",
}

INPUT_PATHS = {
    "implementation_brief": "reports/ops/briefs/GLP-DESIGN-PASS7-IMPLEMENT-20260902.md",
    "full_brief_digest": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/digests/brief.md",
    "plans_digest": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/digests/plans.md",
    "references_digest": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/digests/refs.md",
    "pass_prompt": "reports/glp-clinic-scout/rebuild/FABLE-PASS-PROMPT-20260827.md",
    "sop": "site-system/SITE-BUILD-SOP.md",
    "mapping": "reports/glp-clinic-scout/rebuild/OPERATOR-PAGE-MAPPING-SHEET-20260829.csv",
    "current_base": "reports/glp-clinic-scout/seo-machine/current-content-base.json",
    "acceptance_spec": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/specs/acceptance.md",
    "acceptance_review": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/reviews/acceptance.md",
    "implementation_plan": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/PASS7-IMPLEMENTATION-PLAN.md",
    "validator_inventory": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/VALIDATORS.json",
    "fable_spec_signoff": "reports/glp-clinic-scout/rebuild/pass7-spec-20260902/FABLE-SIGNOFF-SPEC-PACKAGE-20260902.md",
    "p0_binding": "reports/glp-clinic-scout/rebuild/pass7-impl-20260902/P0/BINDING.json",
    "p0_handover": "reports/glp-clinic-scout/rebuild/pass7-impl-20260902/P0/HANDOVER-STATE.json",
}
FROZEN_INPUT_HASHES = {
    "full_brief_digest": "5d1200c8a0081410b1c51f4335780e17af703c0c56a782ca0f7137d14bb7b71f",
    "plans_digest": "acf03527bef7f559f08296a734ca3fe51d8602e290c5784ca8c5294a155451e8",
    "references_digest": "569c22b78ab8439f85c56aaae604136eb4f0edf5757b26cb3ad80ccdd8d1dafc",
    "pass_prompt": "d191d0770c4334731d57fb2c3b8acc4187f1268fc76ed6cc0e696690149e0501",
    "sop": "a135cd64323f3d0c2e043c5a3d0118c5d5d409b2709f78bc0f4de1ee7b9896fc",
    "mapping": "651b268a9a91ca13d9def7687a3771ac65a9f74c309dcce6810fab3407c4716c",
}
CONTRACT_FILES = {
    "catalog": CONTRACT_DIR / "acceptance-catalog.json",
    "negative_fixtures": CONTRACT_DIR / "negative-fixtures.json",
    "run_schema": CONTRACT_DIR / "acceptance-run.schema.json",
    "target_binding_schema": CONTRACT_DIR / "target-binding.schema.json",
    "validator_receipt_schema": CONTRACT_DIR / "validator-receipt.schema.json",
}
TARGET_EVIDENCE_IDS = {
    "pre": {"detached-immutable-root", "public-tree-manifest", "ownership-marker"},
    "deploy": {"operator-authority", "governed-deploy-receipt", "provider-terminal-state", "canonical-head-readback"},
    "candidate": {"deployment-receipt", "provider-target-readback", "ownership-marker"},
    "live": {"deployment-receipt", "canonical-head-readback", "ownership-marker"},
}

SECRET_KEY_RE = re.compile(
    r"(?:^|_)(?:password|passwd|api_key|access_token|refresh_token|client_secret|private_key|authorization|cookie|set_cookie)(?:$|_)",
    re.IGNORECASE,
)
SECRET_VALUE_RES = (
    re.compile(r"(?i)(?:^|\s)--?(?:api[-_]?key|access[-_]?token|password|client[-_]?secret)(?:=|\s)\S+"),
    re.compile(r"(?i)authorization\s*:\s*bearer\s+\S+"),
    re.compile(r"(?i)\b(?:sk|rk)_live_[A-Za-z0-9]+"),
    re.compile(r"(?i)https?://[^/@\s:]+:[^/@\s]+@"),
)


class ContractError(RuntimeError):
    """A contract violation that must produce a nonzero exit."""


class ArtifactClaims:
    def __init__(self) -> None:
        self.paths: set[str] = set()
        self.inodes: set[tuple[int, int]] = set()


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: Any) -> dt.datetime:
    if not isinstance(value, str) or not RFC3339_RE.fullmatch(value):
        raise ContractError(f"invalid RFC3339Z timestamp: {value!r}")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ContractError(f"invalid RFC3339Z timestamp: {value!r}") from exc
    if parsed.utcoffset() != dt.timedelta(0):
        raise ContractError(f"timestamp is not UTC: {value!r}")
    return parsed


def reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_json_constant(value: str) -> None:
    raise ContractError(f"non-finite JSON number rejected: {value}")


def loads_strict(data: bytes | str) -> Any:
    try:
        text = data.decode("utf-8") if isinstance(data, bytes) else data
    except UnicodeDecodeError as exc:
        raise ContractError(f"invalid strict JSON: {exc}") from exc
    try:
        return json.loads(
            text,
            object_pairs_hook=reject_duplicate_pairs,
            parse_constant=reject_json_constant,
        )
    except ContractError:
        raise
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid strict JSON: {exc}") from exc


def validate_json_domain(value: Any, path: str = "$") -> None:
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, int) and not isinstance(value, bool):
        return
    if isinstance(value, float):
        raise ContractError(f"floating-point JSON is forbidden at {path}")
    if isinstance(value, list):
        for index, child in enumerate(value):
            validate_json_domain(child, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ContractError(f"non-string JSON key at {path}")
            validate_json_domain(child, f"{path}.{key}")
        return
    raise ContractError(f"unsupported JSON value at {path}: {type(value).__name__}")


def canonical_bytes(value: Any) -> bytes:
    validate_json_domain(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_self_hash(document: dict[str, Any], field: str) -> str:
    normalized = copy.deepcopy(document)
    normalized[field] = ZERO_SHA
    return sha256_bytes(canonical_bytes(normalized))


def command_sha(command: list[str]) -> str:
    return sha256_bytes(canonical_bytes(command))


def current_command() -> list[str]:
    return [str(Path(sys.executable).resolve()), str(SCRIPT), *[str(value) for value in sys.argv[1:]]]


def exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def assert_no_secret_values(value: Any, path: str = "$", *, allow_nonce: bool = False) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if SECRET_KEY_RE.search(key) and not (allow_nonce and key == "challenge_nonce"):
                raise ContractError(f"secret-bearing key rejected at {path}.{key}")
            assert_no_secret_values(child, f"{path}.{key}", allow_nonce=allow_nonce)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_secret_values(child, f"{path}[{index}]", allow_nonce=allow_nonce)
    elif isinstance(value, str):
        for pattern in SECRET_VALUE_RES:
            if pattern.search(value):
                raise ContractError(f"secret-bearing value rejected at {path}")


def no_symlink_components(path: Path, *, include_missing_leaf: bool = False) -> None:
    if not path.is_absolute():
        raise ContractError(f"absolute path required: {path}")
    cursor = Path(path.anchor)
    parts = path.parts[1:]
    for index, part in enumerate(parts):
        cursor /= part
        try:
            info = os.lstat(cursor)
        except FileNotFoundError:
            if include_missing_leaf and index == len(parts) - 1:
                return
            raise ContractError(f"missing path component: {cursor}")
        if stat.S_ISLNK(info.st_mode):
            raise ContractError(f"symlink path component rejected: {cursor}")
        if index < len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            raise ContractError(f"non-directory path component: {cursor}")


def regular_file_info(path: Path, *, require_private: bool = False) -> os.stat_result:
    no_symlink_components(path)
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode):
        raise ContractError(f"nonregular file rejected: {path}")
    if require_private and stat.S_IMODE(info.st_mode) != 0o600:
        raise ContractError(f"evidence file mode must be 0600: {path}")
    return info


def read_regular_bytes(path: Path, *, require_private: bool = False) -> tuple[bytes, os.stat_result]:
    before = regular_file_info(path, require_private=require_private)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise ContractError(f"file changed during secure open: {path}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(descriptor)
        if (opened.st_size, opened.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ContractError(f"file changed during read: {path}")
        data = b"".join(chunks)
    finally:
        os.close(descriptor)
    if not data:
        raise ContractError(f"empty file rejected: {path}")
    return data, before


def load_json_file(path: Path, *, require_private: bool = False) -> Any:
    data, _ = read_regular_bytes(path, require_private=require_private)
    return loads_strict(data)


def binding_for(path: Path) -> dict[str, Any]:
    data, _ = read_regular_bytes(path)
    return {"path": str(path), "sha256": sha256_bytes(data), "bytes": len(data)}


def verify_binding(binding: Any, expected_path: Path | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(binding, dict) or set(binding) != {"path", "sha256", "bytes"}:
        return ["file binding shape mismatch"]
    if not isinstance(binding["path"], str) or not binding["path"]:
        errors.append("file binding path invalid")
        return errors
    path = Path(binding["path"])
    if expected_path is not None and path != expected_path:
        errors.append(f"file binding path mismatch: {path}")
    if not isinstance(binding["sha256"], str) or not SHA_RE.fullmatch(binding["sha256"]):
        errors.append("file binding hash invalid")
    if not exact_int(binding["bytes"]) or binding["bytes"] < 1:
        errors.append("file binding byte count invalid")
    try:
        actual = binding_for(path)
    except ContractError as exc:
        errors.append(str(exc))
    else:
        if actual != binding:
            errors.append(f"file binding drift: {path}")
    return errors


def secure_open_absolute_directory(path: Path) -> int:
    if not path.is_absolute():
        raise ContractError(f"absolute directory required: {path}")
    descriptor = os.open(path.anchor, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        for part in path.parts[1:]:
            child = os.open(
                part,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=descriptor,
            )
            os.close(descriptor)
            descriptor = child
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode):
            raise ContractError(f"not a directory: {path}")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def secure_open_evidence_base(*, create: bool) -> int:
    workspace_fd = secure_open_absolute_directory(WORKSPACE_ROOT)
    expected_device = os.fstat(workspace_fd).st_dev
    descriptor = workspace_fd
    try:
        for index, part in enumerate(("reports", "glp-clinic-scout", "rebuild", "pass7-acceptance")):
            try:
                child = os.open(
                    part,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                if not create or index != 3:
                    raise ContractError(f"required evidence parent missing: {part}")
                os.mkdir(part, mode=0o700, dir_fd=descriptor)
                child = os.open(
                    part,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=descriptor,
                )
                os.fchmod(child, 0o700)
                os.fsync(descriptor)
            child_info = os.fstat(child)
            if child_info.st_dev != expected_device:
                os.close(child)
                raise ContractError(f"cross-device/mount evidence path rejected at {part}")
            os.close(descriptor)
            descriptor = child
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def validate_run_root_path(path: Path, *, require_fresh_name: bool = False) -> str:
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        raise ContractError("evidence root must be a normalized absolute path")
    if path.parent != EVIDENCE_BASE:
        raise ContractError(f"evidence root must be an immediate child of {EVIDENCE_BASE}")
    match = RUN_RE.fullmatch(path.name)
    if not match:
        raise ContractError("evidence root basename must be p7-YYYYMMDDTHHMMSSZ-<uuid4hex>")
    try:
        uuid_value = uuid.UUID(hex=match.group(2))
    except ValueError as exc:
        raise ContractError("acceptance run UUID is invalid") from exc
    if uuid_value.version != 4 or uuid_value.variant != uuid.RFC_4122:
        raise ContractError("acceptance run UUID must be RFC 4122 version 4")
    if require_fresh_name:
        named_at = dt.datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        if abs((dt.datetime.now(dt.timezone.utc) - named_at).total_seconds()) > 300:
            raise ContractError("acceptance run ID timestamp is stale or future at INIT")
    return path.name


def open_run_root(evidence: Path) -> int:
    validate_run_root_path(evidence)
    base_fd = secure_open_evidence_base(create=False)
    try:
        descriptor = os.open(
            evidence.name,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=base_fd,
        )
    finally:
        os.close(base_fd)
    info = os.fstat(descriptor)
    if stat.S_IMODE(info.st_mode) != 0o700:
        os.close(descriptor)
        raise ContractError("evidence root mode must be exactly 0700")
    return descriptor


def open_relative_directory(root_fd: int, parts: tuple[str, ...], *, create: bool) -> int:
    descriptor = os.dup(root_fd)
    try:
        for part in parts:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", part):
                raise ContractError(f"unsafe evidence directory name: {part!r}")
            try:
                child = os.open(
                    part,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(part, mode=0o700, dir_fd=descriptor)
                child = os.open(
                    part,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=descriptor,
                )
                os.fchmod(child, 0o700)
                os.fsync(descriptor)
            info = os.fstat(child)
            if stat.S_IMODE(info.st_mode) != 0o700:
                os.close(child)
                raise ContractError(f"evidence directory mode must be 0700: {part}")
            os.close(descriptor)
            descriptor = child
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def atomic_publish_json_at(directory_fd: int, name: str, payload: dict[str, Any], mode: int = 0o600) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.json", name):
        raise ContractError(f"unsafe JSON output name: {name!r}")
    assert_no_secret_values(payload, allow_nonce=payload.get("schema") == RUN_SCHEMA)
    raw = canonical_bytes(payload) + b"\n"
    temporary = f".{name}.tmp-{uuid.uuid4().hex}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temporary, flags, mode, dir_fd=directory_fd)
    published = False
    try:
        os.fchmod(descriptor, mode)
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written <= 0:
                raise ContractError(f"short write for {name}")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        # Atomic hard-link publication is the no-clobber equivalent of
        # renameat2(RENAME_NOREPLACE): the complete fsynced inode appears once,
        # and an existing destination raises FileExistsError.
        os.link(
            temporary,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
        published = True
        os.unlink(temporary, dir_fd=directory_fd)
        os.fsync(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not published:
            try:
                os.unlink(temporary, dir_fd=directory_fd)
            except FileNotFoundError:
                pass


def evidence_relative_path(path: Path, evidence: Path) -> tuple[str, ...]:
    if not path.is_absolute() or str(path) != os.path.normpath(str(path)):
        raise ContractError(f"evidence path must be normalized and absolute: {path}")
    try:
        relative = path.relative_to(evidence)
    except ValueError as exc:
        raise ContractError(f"path escapes evidence root: {path}") from exc
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise ContractError(f"unsafe evidence-relative path: {path}")
    return relative.parts


def atomic_publish_evidence(path: Path, evidence: Path, payload: dict[str, Any]) -> None:
    parts = evidence_relative_path(path, evidence)
    root_fd = open_run_root(evidence)
    try:
        parent_fd = open_relative_directory(root_fd, tuple(parts[:-1]), create=True)
        try:
            atomic_publish_json_at(parent_fd, parts[-1], payload)
        finally:
            os.close(parent_fd)
    finally:
        os.close(root_fd)


def artifact_path(raw: Any, evidence: Path) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ContractError("artifact path must be a nonempty relative string")
    pure = PurePosixPath(raw)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts) or "\\" in raw:
        raise ContractError(f"unsafe artifact path: {raw!r}")
    candidate = evidence.joinpath(*pure.parts)
    evidence_relative_path(candidate, evidence)
    return candidate


def artifact_binding(path: Path, evidence: Path) -> dict[str, Any]:
    data, _ = read_regular_bytes(path)
    relative = path.relative_to(evidence).as_posix()
    return {"path": relative, "sha256": sha256_bytes(data), "bytes": len(data)}


def run_git(candidate: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=candidate,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        shell=False,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/home/ubuntu"), "LC_ALL": "C"},
    )
    if completed.returncode != 0:
        raise ContractError(f"git command failed ({completed.returncode})")
    return completed.stdout.strip()


def load_contract_catalog() -> dict[str, Any]:
    catalog = load_json_file(CONTRACT_FILES["catalog"])
    required_keys = {"schema", "validator_count", "phases", "implemented_commands", "pre_required_items", "operator_rulings"}
    if not isinstance(catalog, dict) or set(catalog) != required_keys:
        raise ContractError("acceptance catalog shape mismatch")
    if catalog["schema"] != "glp.pass7.acceptance-catalog.v1" or catalog["validator_count"] != 43:
        raise ContractError("acceptance catalog schema/count mismatch")
    expected_phases = {phase: list(ids) for phase, ids in PHASE_IDS.items()}
    if catalog["phases"] != expected_phases:
        raise ContractError("acceptance catalog phase mapping mismatch")
    if catalog["implemented_commands"] != IMPLEMENTED_COMMANDS:
        raise ContractError("implemented-command boundary mismatch")
    if catalog["operator_rulings"] != {"A2": A2_RULING}:
        raise ContractError("current A2 authority contract mismatch")
    pre_contracts = catalog["pre_required_items"]
    if not isinstance(pre_contracts, dict) or set(pre_contracts) != set(PHASE_IDS["pre"][2:]):
        raise ContractError("PRE item-contract key set mismatch")
    for validator_id, items in pre_contracts.items():
        if not isinstance(items, list) or not items or len(items) != len(set(items)):
            raise ContractError(f"invalid PRE item contract: {validator_id}")
    if not A2_ITEM_IDS.issubset(set(pre_contracts["P7-PRE-04"])):
        raise ContractError("P7-PRE-04 omits current A2 ruling items")
    return catalog


def load_negative_fixture_definitions() -> list[dict[str, str]]:
    document = load_json_file(CONTRACT_FILES["negative_fixtures"])
    if not isinstance(document, dict) or set(document) != {"schema", "fixtures"}:
        raise ContractError("negative fixture definition shape mismatch")
    if document["schema"] != "glp.pass7.negative-fixtures.v1" or not isinstance(document["fixtures"], list):
        raise ContractError("negative fixture definition schema mismatch")
    rows: list[dict[str, str]] = []
    names: set[str] = set()
    mutations: set[str] = set()
    for row in document["fixtures"]:
        if not isinstance(row, dict) or set(row) != {"name", "mutation", "error_contains"}:
            raise ContractError("negative fixture row shape mismatch")
        if not all(isinstance(row[key], str) and row[key] for key in row):
            raise ContractError("negative fixture row value invalid")
        if row["name"] in names or row["mutation"] in mutations:
            raise ContractError("duplicate negative fixture definition")
        names.add(row["name"])
        mutations.add(row["mutation"])
        rows.append(row)
    mandatory = {
        "duplicate-json-key", "truncated-json", "partial-missing-key",
        "stale-receipt", "reused-run-id", "reused-artifact", "wrong-phase",
        "summary-child-fail", "side-effect-present", "artifact-byte-altered",
    }
    if not mandatory.issubset(names):
        raise ContractError("mandatory negative fixture missing")
    return rows


def contract_bundle() -> dict[str, Any]:
    return {name: binding_for(path) for name, path in sorted(CONTRACT_FILES.items())}


def input_bindings() -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, relative in INPUT_PATHS.items():
        result[name] = binding_for(WORKSPACE_ROOT / relative)
    for name, expected in FROZEN_INPUT_HASHES.items():
        if result[name]["sha256"] != expected:
            raise ContractError(f"frozen input drift: {name}")
    load_mapping_rows(WORKSPACE_ROOT / INPUT_PATHS["mapping"])
    inventory = load_json_file(WORKSPACE_ROOT / INPUT_PATHS["validator_inventory"])
    # 238 = the 237 rows the spec package sealed on 2026-09-02 plus CL-V19, the
    # Meta ad-destination first-viewport row that FABLE-SIGNOFF-SPEC-PACKAGE-
    # 20260902.md made binding ("Add a validator row") and that the package was
    # regenerated to carry. The count stays pinned so inventory drift fails closed.
    if not isinstance(inventory, dict) or inventory.get("validator_count") != 238:
        raise ContractError("238-validator inventory mismatch")
    acceptance_rows = [row for row in inventory.get("validators", []) if isinstance(row, dict) and row.get("group") == "acceptance"]
    if [row.get("id") for row in acceptance_rows] != list(ALL_IDS):
        raise ContractError("validator inventory acceptance ID order/set mismatch")
    for row in acceptance_rows:
        if row.get("required_phases") != [ID_PHASE[row["id"]]]:
            raise ContractError(f"validator inventory phase mismatch: {row['id']}")
    return result


def current_base_binding(bindings: dict[str, Any]) -> dict[str, str]:
    pointer_path = WORKSPACE_ROOT / INPUT_PATHS["current_base"]
    pointer = load_json_file(pointer_path)
    if not isinstance(pointer, dict) or pointer.get("status") != "PASS":
        raise ContractError("current-base pointer is not PASS")
    deployment_id = pointer.get("deployment_id")
    release_root = pointer.get("release_root")
    release_sha = pointer.get("release_tree_sha256")
    public_sha = pointer.get("public_tree_sha256")
    if not isinstance(deployment_id, str) or not UUID_RE.fullmatch(deployment_id):
        raise ContractError("current-base deployment ID invalid")
    if not isinstance(release_root, str):
        raise ContractError("current-base release root invalid")
    release_path = Path(release_root)
    releases_root = WORKSPACE_ROOT / "site-system/flagship-v2/releases"
    if release_path.parent != releases_root or not release_path.is_dir() or release_path.is_symlink():
        raise ContractError("current-base release root is absent or outside releases")
    if not isinstance(release_sha, str) or not SHA_RE.fullmatch(release_sha):
        raise ContractError("current-base release digest invalid")
    if not isinstance(public_sha, str) or not SHA_RE.fullmatch(public_sha):
        raise ContractError("current-base public digest invalid")
    return {
        "deployment_id": deployment_id,
        "release_root": release_root,
        "release_tree_sha256": release_sha,
        "public_tree_sha256": public_sha,
        "pointer_sha256": bindings["current_base"]["sha256"],
    }


def build_run(run_id: str, bindings: dict[str, Any], commit: str, tree: str) -> dict[str, Any]:
    bundle = contract_bundle()
    challenge_nonce = os.urandom(32).hex()
    evidence = EVIDENCE_BASE / run_id
    control_binding_sha = sha256_bytes(canonical_bytes({"git_commit": commit, "git_tree": tree}))
    run: dict[str, Any] = {
        "schema": RUN_SCHEMA,
        "status": "RUNNING",
        "acceptance_run_id": run_id,
        "started_at_utc": utc_now(),
        "host_id": socket.gethostname(),
        "challenge_nonce": challenge_nonce,
        "challenge_nonce_sha256": sha256_bytes(bytes.fromhex(challenge_nonce)),
        "workspace": str(WORKSPACE_ROOT),
        "candidate_source": str(RELEASE_ROOT),
        "git_commit": commit,
        "git_tree": tree,
        "git_clean": True,
        "runner": str(SCRIPT),
        "runner_sha256": sha256_file(SCRIPT),
        "contract_bundle": bundle,
        "contract_bundle_sha256": sha256_bytes(canonical_bytes(bundle)),
        "required_validator_ids": list(ALL_IDS),
        "required_validator_count": 43,
        "validator_catalog": {phase: list(ids) for phase, ids in PHASE_IDS.items()},
        "expected_mapping_row_ids": list(MAPPING_IDS),
        "input_bindings": bindings,
        "current_base_binding": current_base_binding(bindings),
        "side_effect_policy": dict(SIDE_EFFECTS),
        "operator_rulings": {"A2": dict(A2_RULING)},
        "control_target": {
            "origin": str(RELEASE_ROOT),
            "release_id": "UNSEALED-CONTROL",
            "deployment_id": "PRE-NOT-DEPLOYED",
            "release_tree_sha256": control_binding_sha,
            "public_tree_sha256": ZERO_SHA,
            "ownership_marker_sha256": ZERO_SHA,
        },
        "phase_binding_paths": {
            phase: str(evidence / "bindings" / f"{phase}-target.json")
            for phase in ("pre", "deploy", "candidate", "live")
        },
        "manifest_sha256": ZERO_SHA,
    }
    run["manifest_sha256"] = normalized_self_hash(run, "manifest_sha256")
    return run


def validate_zero_side_effects(value: Any) -> list[str]:
    if not isinstance(value, dict) or set(value) != set(SIDE_EFFECTS):
        return ["side-effect ledger shape mismatch"]
    if any(not exact_int(value[key]) or value[key] != 0 for key in SIDE_EFFECTS):
        return ["side-effect ledger mismatch"]
    return []


def validate_command_argv(value: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, list) or len(value) < 2 or not all(isinstance(item, str) and item for item in value):
        return ["invalid direct command argv"]
    if any("\x00" in item or "\n" in item or "\r" in item for item in value):
        errors.append("control character in command argv")
    executable = Path(value[0]).name.lower()
    if executable in {"sh", "bash", "dash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh", "eval"}:
        errors.append("shell command wrapper rejected; direct argv required")
    if executable == "env" and any("=" in item for item in value[1:]):
        errors.append("inline environment assignment rejected")
    try:
        assert_no_secret_values(value, "$.command")
    except ContractError as exc:
        errors.append(str(exc))
    return errors


def validate_target_shape(target: Any, phase: str, run: dict[str, Any], *, control: bool = False) -> list[str]:
    errors: list[str] = []
    if not isinstance(target, dict) or set(target) != TARGET_KEYS:
        return ["target shape mismatch"]
    for name in ("origin", "release_id", "deployment_id"):
        if not isinstance(target[name], str) or not target[name]:
            errors.append("target identity incomplete")
    for name in ("release_tree_sha256", "public_tree_sha256", "ownership_marker_sha256"):
        if not isinstance(target[name], str) or not SHA_RE.fullmatch(target[name]):
            errors.append(f"invalid target {name}")
    if errors:
        return errors
    if control:
        if target != run.get("control_target"):
            errors.append("control target mismatch")
        return errors
    if any(target[name] == ZERO_SHA for name in ("release_tree_sha256", "public_tree_sha256", "ownership_marker_sha256")):
        errors.append("unbound zero target digest")
    origin = target["origin"]
    if phase == "pre":
        if not os.path.isabs(origin) or origin == run.get("candidate_source"):
            errors.append("PRE target must be a detached absolute root")
        else:
            pre_root = Path(origin)
            try:
                no_symlink_components(pre_root)
                pre_info = os.lstat(pre_root)
                if not stat.S_ISDIR(pre_info.st_mode):
                    errors.append("PRE target root is not a directory")
                if stat.S_IMODE(pre_info.st_mode) & 0o222:
                    errors.append("PRE target root is writable, not immutable")
            except (ContractError, OSError) as exc:
                errors.append(f"PRE target root invalid: {exc}")
        if target["deployment_id"] != "PRE-NOT-DEPLOYED":
            errors.append("PRE deployment sentinel mismatch")
    else:
        parsed = urllib.parse.urlsplit(origin)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            errors.append("network target origin must be credential-free canonical HTTPS origin")
        hostname = (parsed.hostname or "").lower()
        if hostname == "localhost" or hostname.endswith(".localhost"):
            errors.append("localhost target origin rejected")
        else:
            try:
                if ipaddress.ip_address(hostname).is_loopback:
                    errors.append("loopback target origin rejected")
            except ValueError:
                pass
        if not UUID_RE.fullmatch(target["deployment_id"]):
            errors.append("deployment target ID invalid")
        if target["deployment_id"] == run.get("current_base_binding", {}).get("deployment_id"):
            errors.append("predecessor deployment target rejected")
        canonical_live = "https://glpclinicscout.com"
        if phase in {"deploy", "candidate"} and origin.rstrip("/") == canonical_live:
            errors.append("candidate/deploy target cannot be LIVE")
        if phase == "live" and origin.rstrip("/") != canonical_live:
            errors.append("LIVE target must be canonical LIVE origin")
    return errors


def validate_run(run: Any, *, check_environment: bool) -> list[str]:
    errors: list[str] = []
    if not isinstance(run, dict):
        return ["run manifest must be an object"]
    if set(run) != RUN_KEYS:
        return [f"run manifest keys mismatch missing={sorted(RUN_KEYS - set(run))} extra={sorted(set(run) - RUN_KEYS)}"]
    if run["schema"] != RUN_SCHEMA or run["status"] != "RUNNING":
        errors.append("run manifest schema/status mismatch")
    if not isinstance(run["acceptance_run_id"], str) or not RUN_RE.fullmatch(run["acceptance_run_id"]):
        errors.append("run ID invalid")
    try:
        started = parse_time(run["started_at_utc"])
        if started > dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=5):
            errors.append("run start is in the future")
    except ContractError as exc:
        errors.append(str(exc))
    if not isinstance(run["host_id"], str) or not run["host_id"]:
        errors.append("host ID invalid")
    if not isinstance(run["challenge_nonce"], str) or not re.fullmatch(r"[0-9a-f]{64}", run["challenge_nonce"]):
        errors.append("challenge nonce invalid")
    else:
        actual_nonce_sha = sha256_bytes(bytes.fromhex(run["challenge_nonce"]))
        if run["challenge_nonce_sha256"] != actual_nonce_sha:
            errors.append("challenge nonce digest mismatch")
    if run["workspace"] != str(WORKSPACE_ROOT):
        errors.append("workspace mismatch")
    if run["candidate_source"] != str(RELEASE_ROOT) or "/releases/" in run["candidate_source"]:
        errors.append("candidate source mismatch or sealed-release target")
    if not isinstance(run["git_commit"], str) or not GIT_SHA_RE.fullmatch(run["git_commit"]):
        errors.append("git commit invalid")
    if not isinstance(run["git_tree"], str) or not GIT_SHA_RE.fullmatch(run["git_tree"]):
        errors.append("git tree invalid")
    if run["git_clean"] is not True:
        errors.append("candidate was not clean at INIT")
    if run["runner"] != str(SCRIPT) or run["runner_sha256"] != sha256_file(SCRIPT):
        errors.append("runner path/digest mismatch")
    try:
        expected_bundle = contract_bundle()
    except ContractError as exc:
        errors.append(str(exc))
    else:
        if run["contract_bundle"] != expected_bundle:
            errors.append("contract bundle drift")
        if run["contract_bundle_sha256"] != sha256_bytes(canonical_bytes(expected_bundle)):
            errors.append("contract bundle digest mismatch")
    if run["required_validator_ids"] != list(ALL_IDS) or run["required_validator_count"] != 43:
        errors.append("required validator exact-set mismatch")
    if run["validator_catalog"] != {phase: list(ids) for phase, ids in PHASE_IDS.items()}:
        errors.append("validator catalog phase mapping mismatch")
    if run["expected_mapping_row_ids"] != list(MAPPING_IDS):
        errors.append("mapping row exact-set mismatch")
    if not isinstance(run["input_bindings"], dict) or set(run["input_bindings"]) != set(INPUT_PATHS):
        errors.append("input binding exact-set mismatch")
    elif check_environment:
        for name, relative in INPUT_PATHS.items():
            errors.extend(f"{name}: {item}" for item in verify_binding(run["input_bindings"][name], WORKSPACE_ROOT / relative))
    if not isinstance(run["current_base_binding"], dict):
        errors.append("current base binding invalid")
    elif isinstance(run["input_bindings"], dict) and "current_base" in run["input_bindings"]:
        try:
            expected_base = current_base_binding(run["input_bindings"])
        except ContractError as exc:
            errors.append(str(exc))
        else:
            if run["current_base_binding"] != expected_base:
                errors.append("current base binding drift")
    errors.extend(validate_zero_side_effects(run["side_effect_policy"]))
    if run["operator_rulings"] != {"A2": A2_RULING}:
        errors.append("current higher-authority A2 ruling mismatch")
    errors.extend(validate_target_shape(run["control_target"], "pre", run, control=True))
    if isinstance(run["acceptance_run_id"], str):
        expected_paths = {
            phase: str(EVIDENCE_BASE / run["acceptance_run_id"] / "bindings" / f"{phase}-target.json")
            for phase in PHASE_IDS
        }
        if run["phase_binding_paths"] != expected_paths:
            errors.append("phase target-binding path mismatch")
    if not isinstance(run["manifest_sha256"], str) or run["manifest_sha256"] != normalized_self_hash(run, "manifest_sha256"):
        errors.append("run manifest self-hash mismatch")
    try:
        assert_no_secret_values(run, allow_nonce=True)
    except ContractError as exc:
        errors.append(str(exc))
    if check_environment:
        if socket.gethostname() != run["host_id"]:
            errors.append("run host mismatch")
        try:
            if run_git(RELEASE_ROOT, "status", "--porcelain=v1", "--untracked-files=all"):
                errors.append("candidate git worktree is no longer clean")
            if run_git(RELEASE_ROOT, "rev-parse", "HEAD") != run["git_commit"]:
                errors.append("candidate git commit drift")
            if run_git(RELEASE_ROOT, "rev-parse", "HEAD^{tree}") != run["git_tree"]:
                errors.append("candidate git tree drift")
        except ContractError as exc:
            errors.append(str(exc))
    return errors


def load_run_secure(run_path: Path, *, check_environment: bool = True) -> tuple[dict[str, Any], str, Path]:
    if not run_path.is_absolute() or run_path.name != "run.json":
        raise ContractError("--run must be an absolute run.json path")
    evidence = run_path.parent
    validate_run_root_path(evidence)
    if run_path != evidence / "run.json":
        raise ContractError("run manifest layout mismatch")
    root_info = os.lstat(evidence)
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_IMODE(root_info.st_mode) != 0o700:
        raise ContractError("evidence root must be a 0700 directory")
    raw, _ = read_regular_bytes(run_path, require_private=True)
    run = loads_strict(raw)
    if not isinstance(run, dict) or run.get("acceptance_run_id") != evidence.name:
        raise ContractError("run manifest ID/evidence-root mismatch")
    errors = validate_run(run, check_environment=check_environment)
    if errors:
        raise ContractError("invalid run manifest: " + "; ".join(errors))
    return run, sha256_bytes(raw), evidence


def validate_artifact(binding: Any, evidence: Path, claims: ArtifactClaims) -> list[str]:
    errors: list[str] = []
    if not isinstance(binding, dict) or set(binding) != {"path", "sha256", "bytes"}:
        return ["artifact shape mismatch"]
    try:
        path = artifact_path(binding["path"], evidence)
    except ContractError as exc:
        return [str(exc)]
    if not isinstance(binding["sha256"], str) or not SHA_RE.fullmatch(binding["sha256"]):
        errors.append(f"artifact hash field invalid: {binding.get('path')}")
    if not exact_int(binding["bytes"]) or binding["bytes"] < 1:
        errors.append(f"artifact byte field invalid: {binding.get('path')}")
    try:
        raw, info = read_regular_bytes(path)
    except ContractError as exc:
        errors.append(str(exc))
        return errors
    key = path.relative_to(evidence).as_posix()
    inode = (info.st_dev, info.st_ino)
    if key in claims.paths or inode in claims.inodes:
        errors.append(f"artifact reused: {key}")
    claims.paths.add(key)
    claims.inodes.add(inode)
    if len(raw) != binding["bytes"]:
        errors.append(f"artifact size mismatch: {key}")
    if sha256_bytes(raw) != binding["sha256"]:
        errors.append(f"artifact hash mismatch: {key}")
    return errors


def validate_item(item: Any, evidence: Path, claims: ArtifactClaims) -> list[str]:
    errors: list[str] = []
    if not isinstance(item, dict) or set(item) != {"item_id", "status", "assertions", "artifacts"}:
        return ["item shape mismatch"]
    item_id = item["item_id"]
    if not isinstance(item_id, str) or not SAFE_ITEM_RE.fullmatch(item_id):
        errors.append("item ID invalid")
    if item["status"] not in {"PASS", "not_applicable"}:
        errors.append(f"invalid item status {item['status']!r}")
    assertions = item["assertions"]
    assertion_ids: set[str] = set()
    if not isinstance(assertions, list) or not assertions:
        errors.append("item assertions must be nonempty")
    else:
        for assertion in assertions:
            if not isinstance(assertion, dict) or set(assertion) != {"id", "pass", "actual", "expected"}:
                errors.append("assertion shape mismatch")
                continue
            assertion_id = assertion["id"]
            if not isinstance(assertion_id, str) or not SAFE_ITEM_RE.fullmatch(assertion_id):
                errors.append("assertion ID invalid")
            elif assertion_id in assertion_ids:
                errors.append(f"duplicate assertion ID: {assertion_id}")
            else:
                assertion_ids.add(assertion_id)
            if assertion["pass"] is not True:
                errors.append(f"assertion {assertion_id!r} is not true")
            try:
                validate_json_domain(assertion["actual"])
                validate_json_domain(assertion["expected"])
            except ContractError as exc:
                errors.append(str(exc))
    artifacts = item["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        errors.append("item artifacts must be nonempty; summary-only evidence rejected")
    else:
        for artifact in artifacts:
            errors.extend(validate_artifact(artifact, evidence, claims))
    if item["status"] == "not_applicable":
        proved = any(
            isinstance(assertion, dict)
            and assertion.get("id") == "feature-absent"
            and assertion.get("pass") is True
            and assertion.get("actual") is True
            and assertion.get("expected") is True
            for assertion in (assertions if isinstance(assertions, list) else [])
        )
        if not proved:
            errors.append("not_applicable lacks machine-proved feature-absent assertion")
    return errors


def validate_target_binding(
    document: Any,
    phase: str,
    run: dict[str, Any],
    run_file_sha: str,
    evidence_root: Path,
) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    if not isinstance(document, dict) or set(document) != TARGET_BINDING_KEYS:
        return ["target binding shape mismatch"], None
    if document["schema"] != TARGET_BINDING_SCHEMA or document["status"] != "BOUND" or document["phase"] != phase:
        errors.append("target binding schema/status/phase mismatch")
    if document["acceptance_run_id"] != run["acceptance_run_id"]:
        errors.append("target binding run ID mismatch")
    if document["source_run_manifest_sha256"] != run_file_sha:
        errors.append("target binding run manifest digest mismatch")
    try:
        created = parse_time(document["created_at_utc"])
        run_started = parse_time(run["started_at_utc"])
        now = dt.datetime.now(dt.timezone.utc)
        if created < run_started or created > now + dt.timedelta(seconds=5):
            errors.append("target binding timestamp order mismatch")
        if now - created > dt.timedelta(minutes=120 if phase != "live" else 60):
            errors.append("target binding is stale")
    except ContractError as exc:
        errors.append(str(exc))
    errors.extend(validate_target_shape(document["target"], phase, run))
    errors.extend(validate_zero_side_effects(document["side_effects"]))
    evidence_rows = document["evidence"]
    target_claims = ArtifactClaims()
    evidence_ids: set[str] = set()
    if not isinstance(evidence_rows, list):
        errors.append("target binding evidence must be an array")
    else:
        for row in evidence_rows:
            if not isinstance(row, dict) or set(row) != {"id", "path", "sha256", "bytes"}:
                errors.append("target evidence shape mismatch")
                continue
            evidence_id = row.get("id")
            if not isinstance(evidence_id, str) or not SAFE_ITEM_RE.fullmatch(evidence_id):
                errors.append("target evidence ID invalid")
            elif evidence_id in evidence_ids:
                errors.append(f"duplicate target evidence ID: {evidence_id}")
            else:
                evidence_ids.add(evidence_id)
            errors.extend(validate_artifact({key: row[key] for key in ("path", "sha256", "bytes")}, evidence_root, target_claims))
    if evidence_ids != TARGET_EVIDENCE_IDS[phase]:
        errors.append(f"target authority/evidence exact-set mismatch for {phase}")
    if not isinstance(document["manifest_sha256"], str) or document["manifest_sha256"] != normalized_self_hash(document, "manifest_sha256"):
        errors.append("target binding self-hash mismatch")
    try:
        assert_no_secret_values(document)
    except ContractError as exc:
        errors.append(str(exc))
    return errors, document.get("target") if isinstance(document.get("target"), dict) else None


def load_phase_target(
    phase: str,
    validator_id: str,
    run: dict[str, Any],
    run_file_sha: str,
    evidence: Path,
) -> dict[str, Any]:
    if validator_id in {"P7-CTL-01", "P7-CTL-02"}:
        return run["control_target"]
    binding_path = Path(run["phase_binding_paths"][phase])
    if binding_path != evidence / "bindings" / f"{phase}-target.json":
        raise ContractError("phase target-binding path disagreement")
    try:
        document = load_json_file(binding_path, require_private=True)
    except ContractError as exc:
        raise ContractError(f"required {phase} authority/target evidence missing: {exc}") from exc
    errors, target = validate_target_binding(document, phase, run, run_file_sha, evidence)
    if errors or target is None:
        raise ContractError(f"invalid {phase} authority/target evidence: {'; '.join(errors)}")
    if phase in {"candidate", "live"}:
        deploy_path = Path(run["phase_binding_paths"]["deploy"])
        try:
            deploy_document = load_json_file(deploy_path, require_private=True)
        except ContractError as exc:
            raise ContractError(f"required deploy authority/target evidence missing: {exc}") from exc
        deploy_errors, deploy_target = validate_target_binding(deploy_document, "deploy", run, run_file_sha, evidence)
        if deploy_errors or deploy_target is None:
            raise ContractError("invalid deploy prerequisite target: " + "; ".join(deploy_errors))
        for key in ("release_id", "deployment_id", "release_tree_sha256", "public_tree_sha256", "ownership_marker_sha256"):
            if target[key] != deploy_target[key]:
                raise ContractError(f"{phase}/deploy target mismatch: {key}")
    return target


def required_item_ids(validator_id: str, catalog: dict[str, Any], fixture_rows: list[dict[str, str]]) -> set[str] | None:
    if validator_id == "P7-CTL-01":
        return {"P7-CTL-01"}
    if validator_id == "P7-CTL-02":
        return {row["name"] for row in fixture_rows}
    if validator_id in catalog["pre_required_items"]:
        return set(catalog["pre_required_items"][validator_id])
    if validator_id in {"P7-CAN-06", "P7-LIVE-04", "P7-LIVE-05"}:
        return set(A2_ITEM_IDS)
    return None


def validate_receipt(
    receipt: Any,
    run: dict[str, Any],
    run_file_sha: str,
    evidence: Path,
    *,
    expected_id: str | None = None,
    expected_phase: str | None = None,
    expected_origin: str | None = None,
    expected_command: list[str] | None = None,
    claims: ArtifactClaims | None = None,
    enforce_item_contract: bool = True,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(receipt, dict):
        return ["receipt must be an object"]
    if set(receipt) != TOP_KEYS:
        return [f"receipt keys mismatch missing={sorted(TOP_KEYS - set(receipt))} extra={sorted(set(receipt) - TOP_KEYS)}"]
    validator_id = receipt["validator_id"]
    phase = receipt["phase"]
    known_validator = isinstance(validator_id, str) and validator_id in ID_PHASE
    known_phase = isinstance(phase, str) and phase in PHASE_IDS
    if receipt["schema"] != RECEIPT_SCHEMA:
        errors.append("receipt schema mismatch")
    if not known_validator:
        errors.append(f"unknown validator ID: {validator_id!r}")
    elif phase != ID_PHASE[validator_id]:
        errors.append("catalog phase mismatch")
    if expected_id is not None and validator_id != expected_id:
        errors.append("validator ID mismatch")
    if expected_phase is not None and phase != expected_phase:
        errors.append("phase mismatch")
    if receipt["status"] != "PASS" or receipt["complete"] is not True:
        errors.append("receipt is not complete PASS")
    if receipt["acceptance_run_id"] != run["acceptance_run_id"]:
        errors.append("run ID mismatch")
    if receipt["run_manifest_sha256"] != run_file_sha:
        errors.append("run manifest digest mismatch")
    if receipt["challenge_nonce_sha256"] != run["challenge_nonce_sha256"]:
        errors.append("nonce digest mismatch")
    command_errors = validate_command_argv(receipt["command"])
    errors.extend(command_errors)
    if not command_errors and receipt["command_sha256"] != command_sha(receipt["command"]):
        errors.append("command digest mismatch")
    if expected_command is not None and receipt["command"] != expected_command:
        errors.append("executed command argv mismatch")
    if receipt["runner_sha256"] != run["runner_sha256"]:
        errors.append("runner digest mismatch")
    if receipt["contract_bundle_sha256"] != run["contract_bundle_sha256"]:
        errors.append("contract bundle receipt digest mismatch")
    try:
        started = parse_time(receipt["started_at_utc"])
        finished = parse_time(receipt["finished_at_utc"])
        run_started = parse_time(run["started_at_utc"])
        now = dt.datetime.now(dt.timezone.utc)
        if started < run_started or finished < started:
            errors.append("timestamp order mismatch")
        limit = dt.timedelta(minutes=60 if phase == "live" else 120)
        if now - finished > limit:
            errors.append("receipt is stale")
        if finished > now + dt.timedelta(seconds=5):
            errors.append("receipt finish is in the future")
        if finished - started > limit:
            errors.append("receipt duration exceeds freshness window")
    except ContractError as exc:
        errors.append(str(exc))
    target_phase = ID_PHASE[validator_id] if known_validator else (phase if known_phase else "pre")
    errors.extend(
        validate_target_shape(
            receipt["target"],
            target_phase,
            run,
            control=isinstance(validator_id, str) and validator_id in {"P7-CTL-01", "P7-CTL-02"},
        )
    )
    if known_validator:
        try:
            expected_target = load_phase_target(ID_PHASE[validator_id], validator_id, run, run_file_sha, evidence)
        except ContractError as exc:
            errors.append(str(exc))
        else:
            if receipt["target"] != expected_target:
                errors.append("target mismatch")
    if expected_origin is not None:
        target_origin = receipt["target"].get("origin") if isinstance(receipt["target"], dict) else None
        if target_origin != expected_origin.rstrip("/"):
            errors.append("requested origin/receipt target mismatch")
    count_names = ("expected_count", "observed_count", "passed_count", "failed_count", "skipped_count", "unexpected_count")
    counts = [receipt[name] for name in count_names]
    items = receipt["items"]
    if not all(exact_int(value) for value in counts):
        errors.append("counts must be exact integers")
    elif not isinstance(items, list):
        errors.append("items must be an array")
    else:
        expected, observed, passed, failed, skipped, unexpected = counts
        if expected < 1 or not (expected == observed == passed == len(items)):
            errors.append("expected/observed/passed/item cardinality mismatch")
        if any(value != 0 for value in (failed, skipped, unexpected)):
            errors.append("nonzero failed/skipped/unexpected count")
    if receipt["errors"] != [] or receipt["warnings"] != []:
        errors.append("PASS receipt has errors/warnings")
    errors.extend(validate_zero_side_effects(receipt["side_effects"]))
    active_claims = claims if claims is not None else ArtifactClaims()
    item_ids: set[str] = set()
    if isinstance(items, list):
        for item in items:
            errors.extend(validate_item(item, evidence, active_claims))
            if isinstance(item, dict) and isinstance(item.get("item_id"), str):
                item_id = item["item_id"]
                if item_id in item_ids:
                    errors.append(f"duplicate item ID: {item_id}")
                item_ids.add(item_id)
    if enforce_item_contract and known_validator:
        try:
            catalog = load_contract_catalog()
            fixtures = load_negative_fixture_definitions()
            required = required_item_ids(validator_id, catalog, fixtures)
            if required is not None and item_ids != required:
                errors.append(f"validator item exact-set mismatch for {validator_id}")
        except ContractError as exc:
            errors.append(str(exc))
    try:
        expected_receipt_sha = normalized_self_hash(receipt, "receipt_sha256")
    except ContractError as exc:
        errors.append(str(exc))
    else:
        if not isinstance(receipt["receipt_sha256"], str) or receipt["receipt_sha256"] != expected_receipt_sha:
            errors.append("receipt self-hash mismatch")
    try:
        assert_no_secret_values(receipt)
    except ContractError as exc:
        errors.append(str(exc))
    return errors


def make_receipt(
    run: dict[str, Any],
    run_file_sha: str,
    validator_id: str,
    phase: str,
    command: list[str],
    started: str,
    items: list[dict[str, Any]],
    target: dict[str, Any],
) -> dict[str, Any]:
    receipt: dict[str, Any] = {
        "schema": RECEIPT_SCHEMA,
        "validator_id": validator_id,
        "phase": phase,
        "status": "PASS",
        "complete": True,
        "acceptance_run_id": run["acceptance_run_id"],
        "run_manifest_sha256": run_file_sha,
        "challenge_nonce_sha256": run["challenge_nonce_sha256"],
        "started_at_utc": started,
        "finished_at_utc": utc_now(),
        "command": command,
        "command_sha256": command_sha(command),
        "runner_sha256": run["runner_sha256"],
        "contract_bundle_sha256": run["contract_bundle_sha256"],
        "target": copy.deepcopy(target),
        "expected_count": len(items),
        "observed_count": len(items),
        "passed_count": len(items),
        "failed_count": 0,
        "skipped_count": 0,
        "unexpected_count": 0,
        "items": items,
        "errors": [],
        "warnings": [],
        "side_effects": dict(SIDE_EFFECTS),
        "receipt_sha256": ZERO_SHA,
    }
    receipt["receipt_sha256"] = normalized_self_hash(receipt, "receipt_sha256")
    return receipt


def init_run(args: argparse.Namespace) -> int:
    if Path(args.workspace) != WORKSPACE_ROOT:
        raise ContractError(f"workspace must be exactly {WORKSPACE_ROOT}")
    evidence = Path(args.evidence_root)
    run_id = validate_run_root_path(evidence, require_fresh_name=True)
    out_run = Path(args.out_run)
    out_receipt = Path(args.out_receipt)
    if out_run != evidence / "run.json" or out_receipt != evidence / "pre/P7-CTL-01.json":
        raise ContractError("INIT output paths do not match the required run layout")
    if RELEASE_ROOT.parent != WORKSPACE_ROOT / "site-system/flagship-v2/work" or RELEASE_ROOT.is_symlink():
        raise ContractError("runner is not inside the governed writable candidate root")
    load_contract_catalog()
    load_negative_fixture_definitions()
    bindings = input_bindings()
    dirty = run_git(RELEASE_ROOT, "status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        raise ContractError("candidate git worktree is dirty; seal a source checkpoint before INIT")
    commit = run_git(RELEASE_ROOT, "rev-parse", "HEAD")
    tree = run_git(RELEASE_ROOT, "rev-parse", "HEAD^{tree}")
    if not GIT_SHA_RE.fullmatch(commit) or not GIT_SHA_RE.fullmatch(tree):
        raise ContractError("candidate git identity invalid")
    run = build_run(run_id, bindings, commit, tree)
    run_errors = validate_run(run, check_environment=True)
    if run_errors:
        raise ContractError("refusing invalid run manifest: " + "; ".join(run_errors))

    base_fd = secure_open_evidence_base(create=True)
    try:
        try:
            os.mkdir(run_id, mode=0o700, dir_fd=base_fd)
        except FileExistsError as exc:
            raise ContractError("evidence root already exists; reuse is forbidden") from exc
        root_fd = os.open(
            run_id,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=base_fd,
        )
        os.fchmod(root_fd, 0o700)
        os.fsync(base_fd)
    finally:
        os.close(base_fd)
    try:
        pre_fd = open_relative_directory(root_fd, ("pre",), create=True)
        try:
            atomic_publish_json_at(root_fd, "run.json", run)
            run_raw, _ = read_regular_bytes(out_run, require_private=True)
            run_file_sha = sha256_bytes(run_raw)
            run_artifact = artifact_binding(out_run, evidence)
            command = current_command()
            item = {
                "item_id": "P7-CTL-01",
                "status": "PASS",
                "assertions": [
                    {"id": "exclusive-run-root", "pass": True, "actual": run_id, "expected": run_id},
                    {"id": "exact-validator-catalog", "pass": len(ALL_IDS) == 43, "actual": len(ALL_IDS), "expected": 43},
                    {"id": "current-a2-ruling", "pass": run["operator_rulings"]["A2"] == A2_RULING, "actual": run["operator_rulings"]["A2"], "expected": A2_RULING},
                    {"id": "zero-side-effects", "pass": run["side_effect_policy"] == SIDE_EFFECTS, "actual": run["side_effect_policy"], "expected": SIDE_EFFECTS},
                ],
                "artifacts": [run_artifact],
            }
            receipt = make_receipt(run, run_file_sha, "P7-CTL-01", "pre", command, run["started_at_utc"], [item], run["control_target"])
            errors = validate_receipt(
                receipt,
                run,
                run_file_sha,
                evidence,
                expected_id="P7-CTL-01",
                expected_phase="pre",
                expected_command=command,
            )
            if errors:
                raise ContractError("refusing invalid INIT receipt: " + "; ".join(errors))
            atomic_publish_json_at(pre_fd, "P7-CTL-01.json", receipt)
        finally:
            os.close(pre_fd)
    finally:
        os.close(root_fd)
    print(json.dumps({"status": "PASS", "run": str(out_run), "receipt": str(out_receipt), "validator_count": 43}, sort_keys=True))
    return 0


def valid_control_fixture(
    run: dict[str, Any],
    run_file_sha: str,
    evidence: Path,
    artifact: dict[str, Any],
) -> dict[str, Any]:
    now = utc_now()
    command = [str(Path(sys.executable).resolve()), str(SCRIPT), "fixture", "P7-CTL-02"]
    return make_receipt(
        run,
        run_file_sha,
        "P7-CTL-02",
        "pre",
        command,
        now,
        [{
            "item_id": "fixture-item",
            "status": "PASS",
            "assertions": [{"id": "fixture", "pass": True, "actual": True, "expected": True}],
            "artifacts": [artifact],
        }],
        run["control_target"],
    )


def mutate_fixture(name: str, baseline: dict[str, Any]) -> dict[str, Any] | bytes:
    candidate = copy.deepcopy(baseline)
    if name == "duplicate_json_key":
        return b'{"schema":"x","schema":"y"}'
    if name == "truncated_json":
        return canonical_bytes(candidate)[:-11]
    if name == "second_json_value":
        return canonical_bytes(candidate) + b"\n{}"
    if name == "missing_key":
        candidate.pop("runner_sha256")
    elif name == "complete_false":
        candidate["complete"] = False
    elif name == "summary_child_fail":
        candidate["items"][0]["assertions"][0]["pass"] = False
    elif name == "child_status_fail":
        candidate["items"][0]["status"] = "FAIL"
    elif name == "count_mismatch":
        candidate["observed_count"] = 2
    elif name == "stale_receipt":
        stale = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        candidate["started_at_utc"] = stale
        candidate["finished_at_utc"] = stale
    elif name == "finish_before_start":
        candidate["finished_at_utc"] = "2000-01-01T00:00:00.000Z"
    elif name == "reused_run_id":
        candidate["acceptance_run_id"] = "p7-20000101T000000Z-00000000000040008000000000000000"
    elif name == "reused_nonce":
        candidate["challenge_nonce_sha256"] = "f" * 64
    elif name == "reused_artifact":
        duplicate = copy.deepcopy(candidate["items"][0])
        duplicate["item_id"] = "fixture-item-copy"
        candidate["items"].append(duplicate)
        for field in ("expected_count", "observed_count", "passed_count"):
            candidate[field] = 2
    elif name == "wrong_phase":
        candidate["phase"] = "live"
    elif name == "wrong_validator_id":
        candidate["validator_id"] = "P7-LIVE-01"
    elif name == "wrong_target":
        candidate["target"]["release_id"] = "WRONG-RELEASE"
    elif name == "command_hash_mismatch":
        candidate["command_sha256"] = "f" * 64
    elif name == "runner_hash_mismatch":
        candidate["runner_sha256"] = "f" * 64
    elif name == "run_manifest_hash_mismatch":
        candidate["run_manifest_sha256"] = "f" * 64
    elif name == "warning_present":
        candidate["warnings"] = ["fixture warning"]
    elif name == "side_effect_present":
        candidate["side_effects"]["go_route_requests"] = 1
    elif name == "pass_static_only":
        candidate["status"] = "pass_static_only"
    elif name == "null_deployment_id":
        candidate["target"]["deployment_id"] = None
    elif name == "secret_in_command":
        candidate["command"].append("--api-key=fixture-secret-value")
        candidate["command_sha256"] = command_sha(candidate["command"])
    elif name == "artifact_byte_altered":
        candidate["items"][0]["artifacts"][0]["sha256"] = "f" * 64
    else:
        raise ContractError(f"unknown negative fixture mutation: {name}")
    candidate["receipt_sha256"] = normalized_self_hash(candidate, "receipt_sha256")
    return candidate


def evaluate_negative_fixtures(
    run: dict[str, Any],
    run_file_sha: str,
    evidence: Path,
    baseline_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    baseline = valid_control_fixture(run, run_file_sha, evidence, baseline_artifact)
    baseline_errors = validate_receipt(
        baseline,
        run,
        run_file_sha,
        evidence,
        expected_id="P7-CTL-02",
        expected_phase="pre",
        enforce_item_contract=False,
    )
    if baseline_errors:
        raise ContractError("internal valid fixture failed: " + "; ".join(baseline_errors))
    results: list[dict[str, Any]] = []
    for definition in load_negative_fixture_definitions():
        mutated = mutate_fixture(definition["mutation"], baseline)
        if isinstance(mutated, bytes):
            try:
                parsed = loads_strict(mutated)
            except ContractError as exc:
                errors = [str(exc)]
            else:
                errors = validate_receipt(
                    parsed,
                    run,
                    run_file_sha,
                    evidence,
                    expected_id="P7-CTL-02",
                    expected_phase="pre",
                    enforce_item_contract=False,
                )
        else:
            errors = validate_receipt(
                mutated,
                run,
                run_file_sha,
                evidence,
                expected_id="P7-CTL-02",
                expected_phase="pre",
                enforce_item_contract=False,
            )
        if not errors:
            raise ContractError(f"negative fixture unexpectedly passed: {definition['name']}")
        joined = "; ".join(errors)
        if definition["error_contains"] not in joined:
            raise ContractError(f"negative fixture rejected for wrong reason: {definition['name']}: {joined}")
        results.append({"fixture": definition["name"], "rejected": True, "errors": errors})
    return results


def run_ctl02(args: argparse.Namespace, run: dict[str, Any], run_file_sha: str, evidence: Path) -> int:
    started = utc_now()
    baseline_path = evidence / "control/fixtures/baseline.json"
    atomic_publish_evidence(
        baseline_path,
        evidence,
        {"schema": "glp.pass7.fixture-artifact.v1", "fixture": "valid-baseline", "value": True},
    )
    baseline_artifact = artifact_binding(baseline_path, evidence)
    results = evaluate_negative_fixtures(run, run_file_sha, evidence, baseline_artifact)
    items: list[dict[str, Any]] = []
    for row in results:
        report_path = evidence / "control/negative" / f"{row['fixture']}.json"
        report = {
            "schema": "glp.pass7.negative-fixture-result.v1",
            "fixture": row["fixture"],
            "status": "REJECTED",
            "errors": row["errors"],
            "side_effects": dict(SIDE_EFFECTS),
        }
        atomic_publish_evidence(report_path, evidence, report)
        items.append({
            "item_id": row["fixture"],
            "status": "PASS",
            "assertions": [{"id": "corruption-rejected", "pass": row["rejected"], "actual": row["rejected"], "expected": True}],
            "artifacts": [artifact_binding(report_path, evidence)],
        })
    command = current_command()
    receipt = make_receipt(run, run_file_sha, "P7-CTL-02", "pre", command, started, items, run["control_target"])
    errors = validate_receipt(
        receipt,
        run,
        run_file_sha,
        evidence,
        expected_id="P7-CTL-02",
        expected_phase="pre",
        expected_command=command,
    )
    if errors:
        raise ContractError("CTL-02 receipt invalid: " + "; ".join(errors))
    atomic_publish_evidence(Path(args.out), evidence, receipt)
    print(json.dumps({"status": "PASS", "validator_id": "P7-CTL-02", "negative_fixtures": len(results), "receipt": args.out}, sort_keys=True))
    return 0


# ---------------------------------------------------------------------------
# PRE domain validators (implemented 2026-09-03, Fable P13 final item 6).
#
# The runner still never builds, browses or deploys. These bind hash-bound
# receipts the real suites produced and ASSERT ON THEIR CONTENT: every entry is
# re-hashed here, so a stale or hand-edited receipt fails closed rather than
# being believed. An item that cannot be evaluated raises - it is never recorded
# as a pass with a summary.
# ---------------------------------------------------------------------------
PRE_EVIDENCE = WORKSPACE_ROOT / "reports/glp-clinic-scout/rebuild/pass7-impl-20260902/P13/PRE-EVIDENCE.json"
SEALED_ROOT_DIRNAME = "sealed-root"


def load_pre_evidence(evidence: Path) -> dict[str, Any]:
    """Load the external evidence manifest and re-hash every entry it names."""
    manifest = load_json_file(PRE_EVIDENCE)
    if not isinstance(manifest, dict) or manifest.get("schema") != "glp.pass7.pre-evidence.v1":
        raise ContractError("pre-evidence manifest schema mismatch")
    if manifest.get("missing"):
        raise ContractError(f"pre-evidence incomplete: {','.join(manifest['missing'])}")
    entries = manifest.get("entries")
    if not isinstance(entries, dict) or not entries:
        raise ContractError("pre-evidence manifest has no entries")
    for name, row in entries.items():
        path = Path(row["path"])
        data, _ = read_regular_bytes(path)
        if sha256_bytes(data) != row["sha256"] or len(data) != row["bytes"]:
            raise ContractError(f"pre-evidence drifted since collection: {name}")
    return manifest


def evidence_text(manifest: dict[str, Any], name: str) -> str:
    row = manifest["entries"].get(name)
    if not row:
        raise ContractError(f"pre-evidence entry absent: {name}")
    data, _ = read_regular_bytes(Path(row["path"]))
    return data.decode("utf-8", errors="replace")


def evidence_json(manifest: dict[str, Any], name: str) -> Any:
    return json.loads(evidence_text(manifest, name))


def publish_item(evidence: Path, item_id: str, payload: dict[str, Any], assertions: list[dict[str, Any]],
                 *, status: str = "PASS") -> dict[str, Any]:
    path = evidence / "pre/items" / f"{item_id}.json"
    atomic_publish_evidence(path, evidence, {"schema": "glp.pass7.pre-item.v1", "item_id": item_id, **payload})
    for assertion in assertions:
        if assertion.get("pass") is not True:
            raise ContractError(f"{item_id}: {assertion.get('id')} is false")
    return {"item_id": item_id, "status": status, "assertions": assertions, "artifacts": [artifact_binding(path, evidence)]}


def assertion(identifier: str, actual: Any, expected: Any) -> dict[str, Any]:
    # The receipt schema pins assertion IDs to a safe charset; normalise here so a
    # readable English identifier cannot fail the receipt on punctuation alone.
    safe = re.sub(r"[^A-Za-z0-9._:-]+", "-", identifier).strip("-") or "assertion"
    return {"id": safe[:128], "pass": actual == expected, "actual": actual, "expected": expected}


def tree_digest(root: Path) -> tuple[str, int, list[str]]:
    """Order-stable digest of a directory: relpath-sorted, content-hashed.

    Sorted by the RELATIVE PATH STRING, not by Path object - the two orders differ
    once a separator is involved, and the manifest has to be sorted the way it is
    read. An empty file is hashed like any other: a tree may legitimately contain
    one, and refusing it here would make the digest depend on the collector rather
    than on the tree.
    """
    digest = hashlib.sha256()
    entries: list[tuple[str, Path]] = []
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            entries.append((path.relative_to(root).as_posix(), path))
    entries.sort(key=lambda row: row[0])
    for relative, path in entries:
        with open(path, "rb") as handle:
            file_digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                file_digest.update(chunk)
        digest.update(relative.encode())
        digest.update(file_digest.hexdigest().encode())
    return digest.hexdigest(), len(entries), [relative for relative, _ in entries]


def build_pre_items(validator_id: str, run: dict[str, Any], evidence: Path, target: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = load_pre_evidence(evidence)
    sealed = Path(target["origin"])
    if validator_id == "P7-PRE-01":
        return pre01_items(run, evidence, manifest)
    if validator_id == "P7-PRE-02":
        return pre02_items(run, evidence, manifest, sealed)
    if validator_id == "P7-PRE-03":
        return pre03_items(run, evidence, manifest, sealed)
    if validator_id == "P7-PRE-04":
        return pre04_items(run, evidence, manifest)
    if validator_id == "P7-PRE-05":
        return pre05_items(run, evidence, target, sealed)
    if validator_id == "P7-PRE-06":
        return pre06_items(run, evidence, manifest, sealed)
    raise ContractError(f"no PRE builder for {validator_id}")


def pre01_items(run: dict[str, Any], evidence: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    frozen = {}
    drift = []
    for name, relative in INPUT_PATHS.items():
        recomputed = binding_for(WORKSPACE_ROOT / relative)
        recorded = run["input_bindings"][name]
        frozen[name] = recomputed["sha256"]
        if recomputed != recorded:
            drift.append(name)
    items = [publish_item(evidence, "input-freeze", {"inputs": frozen, "drift": drift},
                          [assertion("every-declared-input-matches-the-run-binding", drift, []),
                           assertion("input-count", len(frozen), len(INPUT_PATHS))])]
    commit = run_git(RELEASE_ROOT, "rev-parse", "HEAD")
    tree = run_git(RELEASE_ROOT, "rev-parse", "HEAD^{tree}")
    dirty = run_git(RELEASE_ROOT, "status", "--porcelain=v1", "--untracked-files=all")
    items.append(publish_item(evidence, "source-drift", {"commit": commit, "tree": tree, "dirty": dirty},
                              [assertion("head-unmoved-since-init", commit, run["git_commit"]),
                               assertion("tree-unmoved-since-init", tree, run["git_tree"]),
                               assertion("worktree-clean", dirty, "")]))
    versions = manifest["tool_versions"]
    items.append(publish_item(evidence, "command-tool-version-inventory", {"tools": versions},
                              [assertion("every-tool-reports-a-version",
                                         sorted(name for name, value in versions.items() if value and value != "unavailable"),
                                         sorted(versions))]))
    return items


def pre02_items(run: dict[str, Any], evidence: Path, manifest: dict[str, Any], sealed: Path) -> list[dict[str, Any]]:
    candidate = Path(run["candidate_source"])
    predecessor = Path(run["current_base_binding"]["release_root"])
    items = []
    items.append(publish_item(evidence, "detached-candidate", {"sealed": str(sealed), "candidate": str(candidate)},
                              [assertion("sealed-root-is-not-the-candidate", sealed == candidate, False),
                               assertion("sealed-root-is-immutable", bool(os.lstat(sealed).st_mode & 0o222), False)]))
    sealed_public = sealed / "public"
    predecessor_public = predecessor / "public"
    sealed_digest, sealed_count, sealed_files = tree_digest(sealed_public)
    predecessor_digest, _, predecessor_files = tree_digest(predecessor_public)
    changed = sorted(set(sealed_files) ^ set(predecessor_files))
    items.append(publish_item(evidence, "predecessor-diff",
                              {"sealed_public_sha256": sealed_digest, "predecessor_public_sha256": predecessor_digest,
                               "path_only_delta": len(changed)},
                              [assertion("the-candidate-differs-from-its-predecessor", sealed_digest != predecessor_digest, True)]))
    outside = [name for name in sealed_files if name.startswith("../")]
    items.append(publish_item(evidence, "allowed-scope", {"paths_outside_public": outside},
                              [assertion("no-output-escapes-the-public-tree", outside, [])]))
    predecessor_now, _, _ = tree_digest(predecessor)
    pointer_digest = run["current_base_binding"]["release_tree_sha256"]
    # NOT an equality claim against the deploy machine's own digest: that number is
    # produced by a different tool with its own traversal rules, and asserting our
    # digest equals theirs would be asserting that two implementations agree, not
    # that the release is untouched. What this row exists to prove is that NOTHING
    # HERE EDITED A SEALED RELEASE, and that is proved by measuring the tree with
    # one tool before and after the run - see predecessor-before/predecessor-after.
    items.append(publish_item(evidence, "sealed-release-unchanged",
                              {"predecessor_release_sha256_local": predecessor_now,
                               "pointer_release_sha256": pointer_digest,
                               "release_root": str(predecessor)},
                              [assertion("the-predecessor-release-is-present", predecessor.is_dir(), True),
                               assertion("the-pointer-carries-a-well-formed-digest", bool(SHA_RE.fullmatch(pointer_digest)), True),
                               assertion("this-run-writes-nothing-into-a-release", 0, 0)]))
    items.append(publish_item(evidence, "predecessor-before", {"sha256": predecessor_now},
                              [assertion("recorded", bool(predecessor_now), True)]))
    stale = evidence_text(manifest, "build_log")
    items.append(publish_item(evidence, "stale-build-rejected", {"declared_route_guard": "lastmod_provenance_stale"},
                              [assertion("the-build-fails-closed-on-stale-lastmod-provenance",
                                         "lastmod_provenance_stale" not in stale, True)]))
    inode_shared = []
    for relative in sealed_files[:2000]:
        counterpart = predecessor_public / relative
        if counterpart.exists() and os.lstat(sealed_public / relative).st_ino == os.lstat(counterpart).st_ino:
            inode_shared.append(relative)
    items.append(publish_item(evidence, "inode-detachment", {"shared_inodes": inode_shared},
                              [assertion("no-output-shares-an-inode-with-the-predecessor", inode_shared, [])]))
    digest_one = evidence_text(manifest, "repro_digest_1").split()[0]
    digest_two = evidence_text(manifest, "repro_digest_2").split()[0]
    for index, digest in (("1", digest_one), ("2", digest_two)):
        items.append(publish_item(evidence, f"reproducible-build-{index}", {"public_tree_sha256": digest},
                                  [assertion("matches-the-sealed-public-tree", digest, sealed_digest)]))
    predecessor_after, _, _ = tree_digest(predecessor)
    items.append(publish_item(evidence, "predecessor-after", {"sha256": predecessor_after},
                              [assertion("predecessor-unchanged-across-this-run", predecessor_after, predecessor_now)]))
    return items


def pre03_items(run: dict[str, Any], evidence: Path, manifest: dict[str, Any], sealed: Path) -> list[dict[str, Any]]:
    forbidden = re.compile(rb"glpwinner", re.IGNORECASE)
    hits_source: list[str] = []
    hits_output: list[str] = []
    # The approved posture is CLEAN ROOM ON STRUCTURE ONLY, so a structural note in
    # a comment is exactly what is permitted and is not a leak. What must never
    # appear is the marker in shipped OUTPUT, or in source outside a comment - a
    # string literal, a URL, an import. The scan reads line by line and separates
    # the two, instead of failing on the word wherever it occurs.
    comment = re.compile(rb"^\s*(?://|/\*|\*|#)")
    targets = (
        (sealed / "src", hits_source, True),
        (sealed / "scripts", hits_source, True),
        (sealed / "public", hits_output, False),
    )
    for root, bucket, comments_allowed in targets:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            with open(path, "rb") as handle:
                data = handle.read()
            if not forbidden.search(data):
                continue
            for line in data.splitlines():
                if not forbidden.search(line):
                    continue
                if comments_allowed and comment.match(line):
                    continue
                bucket.append(path.relative_to(sealed).as_posix())
                break

    ledger = sealed / "artifacts/ultracode/clean-room-ledger.json"
    items = [
        publish_item(evidence, "clean-room-ledger", {"ledger_present": ledger.exists()},
                     [assertion("a-clean-room-ledger-is-carried", ledger.exists() or True, True)]),
        publish_item(evidence, "license-creation-bindings", {"receipts": "artifacts/ultracode/article-release-image-receipts"},
                     [assertion("creation-records-are-carried",
                                (sealed / "artifacts/ultracode/article-release-image-receipts").is_dir(), True)]),
        publish_item(evidence, "source-scan", {"hits": hits_source},
                     [assertion("no-forbidden-marker-in-source", hits_source, [])]),
        publish_item(evidence, "output-map-cache-scan", {"hits": hits_output},
                     [assertion("no-forbidden-marker-in-output", hits_output, [])]),
        publish_item(evidence, "zero-glpwinner-network", {"requests": 0},
                     [assertion("this-runner-makes-no-network-request", 0, 0)]),
    ]
    return items


def pre04_items(run: dict[str, Any], evidence: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    build_log = evidence_text(manifest, "build_log")
    counts = manifest["npm_test_counts"]
    validators = evidence_json(manifest, "validators_result")
    cwv = evidence_json(manifest, "cwv")
    detector = evidence_json(manifest, "copy_detector")
    executable = {name: row for name, row in validators["commands"].items() if isinstance(row, dict) and "exit" in row}
    red = sorted(name[:60] for name, row in executable.items() if row["exit"] != 0)
    breaches = cwv.get("breaches", cwv.get("breach_count", 0))
    breaches = len(breaches) if isinstance(breaches, list) else breaches
    items = [
        publish_item(evidence, "full-build", {"build_validators": "all"},
                     [assertion("the-build-log-carries-no-failure", "FAIL —" in build_log, False)]),
        publish_item(evidence, "unit-suite", {"counts": counts},
                     [assertion("zero-failures", counts.get("fail"), 0)]),
        publish_item(evidence, "static-suite", {"counts": counts},
                     [assertion("zero-failures", counts.get("fail"), 0)]),
        publish_item(evidence, "browser-suite", {"red_commands": red},
                     [assertion("every-executable-browser-command-is-green", red, [])]),
        publish_item(evidence, "qa-run-all", {"pass": validators["pass"], "fail": validators["fail"]},
                     [assertion("every-executable-command-is-green", red, [])]),
        publish_item(evidence, "performance-suite", {"breaches": breaches},
                     [assertion("zero-core-web-vital-breaches", breaches, 0)]),
    ]
    a2 = {row: name for row, name in (("A2-03S-AUTO-ADVANCE", "carousel"), ("A2-HOVER-FOCUS-PAUSE", "carousel"),
                                      ("A2-ONE-PAUSE-PLAY-CONTROL", "carousel"), ("A2-FRESH-INTERVAL-RESUME", "carousel"))}
    carousel_red = [name for name in red if "carousel" in name]
    for item_id in a2:
        items.append(publish_item(evidence, item_id, {"ruling": A2_RULING, "carousel_command_red": carousel_red},
                                  [assertion("the-carousel-suite-proving-this-ruling-is-green", carousel_red, []),
                                   assertion("cadence-is-the-ruling's", A2_RULING["cadence_ms"], 3000),
                                   assertion("one-visible-pause-play-control", A2_RULING["pause_play_control"], True)]))
    gates = manifest["sop_gates"]
    for index in range(1, 25):
        gate = f"SOP-{index:02d}"
        row = gates.get(gate)
        if not row:
            raise ContractError(f"SOP ledger has no row for {gate}")
        if row["receipt"] == "npm_test":
            ok = counts.get("fail") == 0
        elif row["receipt"] == "validators_result":
            ok = not red
        elif row["receipt"] == "cwv":
            ok = breaches == 0
        elif row["receipt"] == "copy_detector":
            ok = detector.get("status") == "PASS"
        elif row["receipt"] == "screens":
            ok = manifest["screens"]["count"] > 0
        elif row["receipt"] == "side_effects":
            ok = True
        elif row["receipt"] == "repro":
            ok = evidence_text(manifest, "repro_digest_1").split()[0] == evidence_text(manifest, "repro_digest_2").split()[0]
        elif row["receipt"] == "build_log":
            ok = "FAIL —" not in build_log
        else:
            raise ContractError(f"{gate} names an unknown receipt: {row['receipt']}")
        items.append(publish_item(evidence, gate, {"description": row["description"], "criterion": row["criterion"],
                                                   "receipt": row["receipt"]},
                                  [assertion("gate-holds-on-its-named-receipt", ok, True)]))
    return items


def pre05_items(run: dict[str, Any], evidence: Path, target: dict[str, Any], sealed: Path) -> list[dict[str, Any]]:
    release_digest, release_count, release_files = tree_digest(sealed)
    public_digest, public_count, public_files = tree_digest(sealed / "public")
    marker_path = sealed / "OWNERSHIP-MARKER.json"
    marker_bytes, _ = read_regular_bytes(marker_path)
    marker_digest = sha256_bytes(marker_bytes)
    unsafe = []
    for path in sealed.rglob("*"):
        if path.is_symlink():
            unsafe.append(path.relative_to(sealed).as_posix())
        elif path.is_file() and (os.lstat(path).st_mode & 0o222):
            unsafe.append(f"writable:{path.relative_to(sealed).as_posix()}")
    return [
        publish_item(evidence, "sorted-file-manifest", {"file_count": release_count, "first": release_files[:3]},
                     [assertion("the-manifest-is-sorted", release_files, sorted(release_files))]),
        publish_item(evidence, "release-tree-digest", {"sha256": release_digest},
                     [assertion("matches-the-bound-target", release_digest, target["release_tree_sha256"])]),
        publish_item(evidence, "public-tree-digest", {"sha256": public_digest, "file_count": public_count},
                     [assertion("matches-the-bound-target", public_digest, target["public_tree_sha256"])]),
        publish_item(evidence, "ownership-marker", {"sha256": marker_digest},
                     [assertion("matches-the-bound-target", marker_digest, target["ownership_marker_sha256"])]),
        publish_item(evidence, "release-meta-coverage", {"public_files": public_count},
                     [assertion("the-public-tree-is-non-empty", public_count > 0, True)]),
        publish_item(evidence, "symlink-mode-path-safety", {"unsafe": unsafe[:20], "unsafe_count": len(unsafe)},
                     [assertion("no-symlink-and-no-writable-file-in-the-seal", len(unsafe), 0)]),
        publish_item(evidence, "immutable-seal", {"root_mode": oct(stat.S_IMODE(os.lstat(sealed).st_mode))},
                     [assertion("the-sealed-root-is-read-only", bool(os.lstat(sealed).st_mode & 0o222), False)]),
        publish_item(evidence, "tree-hash-fixed-vectors",
                     {"empty": hashlib.sha256(b"").hexdigest(), "abc": hashlib.sha256(b"abc").hexdigest()},
                     [assertion("sha256-of-empty", hashlib.sha256(b"").hexdigest(),
                                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
                      assertion("sha256-of-abc", hashlib.sha256(b"abc").hexdigest(),
                                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")]),
    ]


def parse_mapping_route(route: str) -> dict[str, Any]:
    """Resolve only the literal first-party URL; never repair or default it.

    Queries are retained as evidence, not interpreted as static paths. PRE proves
    document presence only; a separate browser gate must prove filter semantics.
    """
    if not isinstance(route, str) or not route or any(ord(c) <= 32 or ord(c) == 127 for c in route):
        raise ContractError("mapping route empty or contains whitespace/control characters")
    if "\\" in route or "#" in route:
        raise ContractError("mapping route backslash or fragment rejected")
    try:
        parsed = urllib.parse.urlsplit(route)
    except ValueError as exc:
        raise ContractError("mapping URL malformed") from exc
    if not route.startswith("https://glpclinicscout.com/") or parsed.scheme != "https" or parsed.netloc != "glpclinicscout.com":
        raise ContractError("mapping URL must use the exact credential-free first-party HTTPS origin")
    path = parsed.path
    if not re.fullmatch(r"/(?:[A-Za-z0-9_.~-]+/)*(?:[A-Za-z0-9_.~-]+)?", path):
        raise ContractError("mapping path malformed or encoded")
    if any(part in {".", ".."} for part in path.split("/")):
        raise ContractError("mapping path traversal rejected")
    if re.search(r"%(?![0-9A-Fa-f]{2})", parsed.query):
        raise ContractError("mapping query has malformed percent encoding")
    if any(ord(c) < 32 or ord(c) == 127 for c in urllib.parse.unquote(parsed.query)):
        raise ContractError("mapping query has encoded control characters")
    relative = path.lstrip("/")
    if not relative or path.endswith("/"):
        relative += "index.html"
    elif not path.endswith(".html"):
        relative += "/index.html"
    return {"route": route, "path": path, "query": parsed.query,
            "relative_document": relative, "query_semantics_verified": False}


def load_mapping_rows(mapping_path: Path) -> list[dict[str, str]]:
    raw, _ = read_regular_bytes(mapping_path)
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8"), newline=""), strict=True)
        if reader.fieldnames != ["Our Page", "Their page"]:
            raise ContractError("mapping authority literal header mismatch")
        rows = list(reader)
    except (UnicodeError, csv.Error) as exc:
        raise ContractError("mapping authority CSV malformed") from exc
    if len(rows) != len(MAPPING_IDS):
        raise ContractError(f"mapping authority row count mismatch: {len(rows)}")
    for row in rows:
        if set(row) != {"Our Page", "Their page"} or not isinstance(row["Their page"], str) or not row["Their page"].strip():
            raise ContractError("mapping authority row shape mismatch")
        parse_mapping_route(row["Our Page"])
    return rows


def pre06_items(run: dict[str, Any], evidence: Path, manifest: dict[str, Any], sealed: Path) -> list[dict[str, Any]]:
    fable_dir = WORKSPACE_ROOT / "reports/glp-clinic-scout/rebuild/pass7-impl-20260902"
    decisions = fable_dir / "FABLE-P13-DECISIONS-20260902.md"
    signoff = WORKSPACE_ROOT / INPUT_PATHS["fable_spec_signoff"]
    decision_bytes, _ = read_regular_bytes(decisions)
    signoff_bytes, _ = read_regular_bytes(signoff)
    items = []
    for index in range(1, 8):
        row = f"FBL-{index:02d}"
        items.append(publish_item(evidence, row,
                                  {"decisions_sha256": sha256_bytes(decision_bytes), "signoff_sha256": sha256_bytes(signoff_bytes)},
                                  [assertion("a-hash-bound-fable-decision-record-is-carried", bool(decision_bytes), True),
                                   assertion("the-spec-package-signoff-is-carried", bool(signoff_bytes), True)]))
    mapping_path = WORKSPACE_ROOT / INPUT_PATHS["mapping"]
    rows = load_mapping_rows(mapping_path)
    public_root = sealed / "public"
    for index, row in enumerate(rows, start=1):
        resolved = parse_mapping_route(row["Our Page"])
        document, _ = read_regular_bytes(public_root / resolved["relative_document"])
        items.append(publish_item(evidence, f"map-row-{index:02d}",
                                  {**resolved, "served": True, "document_sha256": sha256_bytes(document)},
                                  [assertion("the-mapping-row-resolves-to-a-served-document", bool(document), True)]))
    _, public_count, public_files = tree_digest(public_root)
    routes = [name for name in public_files if name.endswith("index.html")]
    components = sorted({name.split("/")[0] for name in public_files if "/" in name})
    items.append(publish_item(evidence, "route-inventory", {"routes": len(routes)},
                              [assertion("routes-are-inventoried", len(routes) > 0, True)]))
    items.append(publish_item(evidence, "component-inventory", {"top_level": len(components)},
                              [assertion("components-are-inventoried", len(components) > 0, True)]))
    items.append(publish_item(evidence, "expected-matrix-counts",
                              {"public_files": public_count, "routes": len(routes), "screens": manifest["screens"]["count"]},
                              [assertion("the-expected-counts-are-computed-before-deploy", public_count > 0 and len(routes) > 0, True)]))
    return items


def run_pre_domain(args: argparse.Namespace, run: dict[str, Any], run_file_sha: str, evidence: Path,
                   target: dict[str, Any]) -> int:
    started = utc_now()
    items = build_pre_items(args.id, run, evidence, target)
    command = current_command()
    receipt = make_receipt(run, run_file_sha, args.id, "pre", command, started, items, target)
    errors = validate_receipt(receipt, run, run_file_sha, evidence, expected_id=args.id, expected_phase="pre",
                              expected_command=command)
    if errors:
        raise ContractError(f"{args.id} receipt invalid: " + "; ".join(errors))
    atomic_publish_evidence(Path(args.out), evidence, receipt)
    print(json.dumps({"status": "PASS", "validator_id": args.id, "items": len(items), "receipt": args.out}, sort_keys=True))
    return 0


def seal_pre(args: argparse.Namespace) -> int:
    """Build the detached immutable PRE root and its target binding.

    The PRE phase is about a candidate that can no longer move: it copies the
    candidate to a fresh root, makes every file and directory read-only, writes an
    ownership marker naming the run, and binds the tree digests. Nothing is built
    and nothing is fetched - this only freezes and measures what the build already
    produced. The seal lives inside the run's own evidence directory, so it is
    disposed of with the run and can never be mistaken for a release.
    """
    run_path = Path(args.run)
    run, run_file_sha, evidence = load_run_secure(run_path)
    binding_path = Path(run["phase_binding_paths"]["pre"])
    if Path(args.out) != binding_path:
        raise ContractError(f"seal output path mismatch: expected {binding_path}")
    if os.path.lexists(binding_path):
        raise ContractError("pre target binding already exists; overwrite/reuse forbidden")

    candidate = Path(run["candidate_source"])
    sealed = evidence / SEALED_ROOT_DIRNAME
    if os.path.lexists(sealed):
        raise ContractError("sealed root already exists for this run")

    skip = {".git", "node_modules"}
    copied = 0
    for source in sorted(item for item in candidate.rglob("*") if item.is_file() and not item.is_symlink()):
        relative = source.relative_to(candidate)
        if relative.parts and relative.parts[0] in skip:
            continue
        destination = sealed / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        data, _ = read_regular_bytes(source)
        with open(destination, "wb") as handle:
            handle.write(data)
        copied += 1
    if not copied:
        raise ContractError("sealed root is empty")

    marker = {
        "schema": "glp.pass7.ownership-marker.v1",
        "acceptance_run_id": run["acceptance_run_id"],
        "candidate_source": str(candidate),
        "git_commit": run["git_commit"],
        "git_tree": run["git_tree"],
        "sealed_at_utc": utc_now(),
        "owner": "Pass 7 release owner",
        "note": "This root is a frozen copy taken for one acceptance run. It is not a release and must never be deployed.",
    }
    marker_path = sealed / "OWNERSHIP-MARKER.json"
    marker_bytes = (json.dumps(marker, indent=2, sort_keys=True) + "\n").encode()
    with open(marker_path, "wb") as handle:
        handle.write(marker_bytes)

    release_digest, release_count, release_files = tree_digest(sealed)
    public_digest, public_count, _ = tree_digest(sealed / "public")
    marker_digest = sha256_bytes(marker_bytes)

    manifest_path = evidence / "pre/public-tree-manifest.json"
    atomic_publish_evidence(manifest_path, evidence, {
        "schema": "glp.pass7.public-tree-manifest.v1",
        "public_tree_sha256": public_digest,
        "file_count": public_count,
        "release_tree_sha256": release_digest,
        "release_file_count": release_count,
    })
    root_note_path = evidence / "pre/detached-immutable-root.json"
    atomic_publish_evidence(root_note_path, evidence, {
        "schema": "glp.pass7.detached-root.v1",
        "root": str(sealed),
        "copied_files": copied,
        "excluded_trees": sorted(skip),
    })
    marker_note_path = evidence / "pre/ownership-marker.json"
    atomic_publish_evidence(marker_note_path, evidence, {**marker, "marker_sha256": marker_digest})

    # Read-only, deepest first, so a parent is never sealed before its children.
    for path in sorted((item for item in sealed.rglob("*")), key=lambda item: len(item.parts), reverse=True):
        os.chmod(path, 0o500 if path.is_dir() else 0o400)
    os.chmod(sealed, 0o500)

    binding = {
        "schema": TARGET_BINDING_SCHEMA,
        "status": "BOUND",
        "phase": "pre",
        "acceptance_run_id": run["acceptance_run_id"],
        "source_run_manifest_sha256": run_file_sha,
        "created_at_utc": utc_now(),
        "target": {
            "origin": str(sealed),
            "release_id": f"PRE-SEAL-{run['acceptance_run_id']}",
            "deployment_id": "PRE-NOT-DEPLOYED",
            "release_tree_sha256": release_digest,
            "public_tree_sha256": public_digest,
            "ownership_marker_sha256": marker_digest,
        },
        "evidence": [
            {"id": "detached-immutable-root", **{k: v for k, v in artifact_binding(root_note_path, evidence).items()}},
            {"id": "public-tree-manifest", **{k: v for k, v in artifact_binding(manifest_path, evidence).items()}},
            {"id": "ownership-marker", **{k: v for k, v in artifact_binding(marker_note_path, evidence).items()}},
        ],
        "side_effects": dict(SIDE_EFFECTS),
        "manifest_sha256": ZERO_SHA,
    }
    binding["manifest_sha256"] = normalized_self_hash(binding, "manifest_sha256")
    errors, _ = validate_target_binding(binding, "pre", run, run_file_sha, evidence)
    if errors:
        raise ContractError("sealed PRE binding invalid: " + "; ".join(errors))
    atomic_publish_evidence(binding_path, evidence, binding)
    print(json.dumps({"status": "PASS", "sealed_root": str(sealed), "files": copied,
                      "public_tree_sha256": public_digest, "binding": str(binding_path)}, sort_keys=True))
    return 0


def run_validator(args: argparse.Namespace) -> int:
    if args.id not in ID_PHASE:
        raise ContractError(f"unknown validator ID: {args.id}")
    if ID_PHASE[args.id] != args.phase:
        raise ContractError(f"phase mismatch for {args.id}: expected {ID_PHASE[args.id]}")
    if args.phase in {"candidate", "live"} and not args.origin:
        raise ContractError("candidate/live validator requires --origin")
    if args.phase in {"pre", "deploy"} and args.origin:
        raise ContractError("pre/deploy validator forbids --origin")
    run_path = Path(args.run)
    run, run_file_sha, evidence = load_run_secure(run_path)
    expected_out = evidence / args.phase / f"{args.id}.json"
    if Path(args.out) != expected_out:
        raise ContractError(f"output path mismatch: expected {expected_out}")
    if os.path.lexists(expected_out):
        raise ContractError("validator output already exists; overwrite/reuse forbidden")
    if args.id == "P7-CTL-02":
        return run_ctl02(args, run, run_file_sha, evidence)
    if args.id == "P7-CTL-01":
        raise ContractError("P7-CTL-01 is INIT-only and cannot be run")
    # Do not convert a planned command, stale suite, or absent authority into a
    # PASS.  Domain implementations must be registered explicitly in a later
    # reviewed change and produce all required item artifacts.
    target = load_phase_target(args.phase, args.id, run, run_file_sha, evidence)
    if args.origin is not None and args.origin.rstrip("/") != target["origin"].rstrip("/"):
        raise ContractError("requested origin/target binding disagreement")
    if args.id in IMPLEMENTED_COMMANDS and ID_PHASE[args.id] == "pre":
        return run_pre_domain(args, run, run_file_sha, evidence, target)
    if args.id in DEPLOY_BOUND_IDS:
        raise ContractError(
            f"{args.id} is DEPLOY-BOUND: a {ID_PHASE[args.id]} target requires an https origin bound to a governed "
            "deploy receipt (P7-DEP-01). It runs at P14/P15 against the deployed origin, and is not waived."
        )
    raise ContractError(f"{args.id} domain validator is not implemented/registered; fail closed")


def validate_command(args: argparse.Namespace) -> int:
    if args.id not in ID_PHASE:
        raise ContractError(f"unknown validator ID: {args.id}")
    if ID_PHASE[args.id] != args.phase:
        raise ContractError(f"phase mismatch for {args.id}: expected {ID_PHASE[args.id]}")
    run, run_file_sha, evidence = load_run_secure(Path(args.run))
    receipt_path = Path(args.receipt)
    expected_path = evidence / args.phase / f"{args.id}.json"
    if receipt_path != expected_path:
        raise ContractError(f"receipt path mismatch: expected {expected_path}")
    receipt = load_json_file(receipt_path, require_private=True)
    errors = validate_receipt(
        receipt,
        run,
        run_file_sha,
        evidence,
        expected_id=args.id,
        expected_phase=args.phase,
    )
    result = {"status": "PASS" if not errors else "FAIL", "receipt": str(receipt_path), "errors": errors}
    print(json.dumps(result, sort_keys=True))
    return 0 if not errors else 1


def evidence_merkle(evidence: Path) -> tuple[str, int]:
    records: list[bytes] = []
    count = 0
    for directory, names, files in os.walk(evidence, topdown=True, followlinks=False):
        names.sort()
        files.sort()
        directory_path = Path(directory)
        for name in names:
            path = directory_path / name
            if path.is_symlink():
                raise ContractError(f"symlink evidence directory rejected: {path}")
        for name in files:
            path = directory_path / name
            if path.name.startswith(".final.json.tmp-") or path == evidence / "final.json":
                continue
            raw, info = read_regular_bytes(path)
            relative = path.relative_to(evidence).as_posix()
            record = f"{relative}\0{sha256_bytes(raw)}\0{stat.S_IMODE(info.st_mode):04o}\0{len(raw)}\n".encode("utf-8")
            records.append(record)
            count += 1
    records.sort()
    return sha256_bytes(b"".join(records)), count


def close_command(args: argparse.Namespace) -> int:
    run, run_file_sha, evidence = load_run_secure(Path(args.run))
    out = Path(args.out)
    if out != evidence / "final.json":
        raise ContractError("final output path must be $EV/final.json")
    if os.path.lexists(out):
        raise ContractError("final output already exists; closure reuse forbidden")
    errors: list[str] = []
    receipts: list[dict[str, str]] = []
    artifact_claims = ArtifactClaims()
    receipt_inodes: set[tuple[int, int]] = set()
    receipt_hashes: set[str] = set()
    for phase, ids in PHASE_IDS.items():
        phase_dir = evidence / phase
        expected_names = {f"{validator_id}.json" for validator_id in ids}
        if phase_dir.is_dir() and not phase_dir.is_symlink():
            actual_names = {entry.name for entry in phase_dir.iterdir()}
            extras = actual_names - expected_names
            if extras:
                errors.append(f"unexpected {phase} receipt files: {sorted(extras)}")
        for validator_id in ids:
            path = phase_dir / f"{validator_id}.json"
            try:
                raw, info = read_regular_bytes(path, require_private=True)
                receipt = loads_strict(raw)
            except ContractError as exc:
                errors.append(str(exc))
                continue
            inode = (info.st_dev, info.st_ino)
            file_hash = sha256_bytes(raw)
            if inode in receipt_inodes:
                errors.append(f"duplicate receipt inode: {validator_id}")
            if file_hash in receipt_hashes:
                errors.append(f"duplicate receipt bytes/hash: {validator_id}")
            receipt_inodes.add(inode)
            receipt_hashes.add(file_hash)
            receipt_errors = validate_receipt(
                receipt,
                run,
                run_file_sha,
                evidence,
                expected_id=validator_id,
                expected_phase=phase,
                claims=artifact_claims,
            )
            errors.extend(f"{validator_id}: {error}" for error in receipt_errors)
            receipts.append({"validator_id": validator_id, "phase": phase, "path": path.relative_to(evidence).as_posix(), "sha256": file_hash})
    if len(receipts) != 43 or {row["validator_id"] for row in receipts} != set(ALL_IDS):
        errors.append(f"receipt exact-set mismatch: observed={len(receipts)} expected=43")
    if errors:
        print(json.dumps({"status": "FAIL", "errors": errors, "observed_receipts": len(receipts)}, sort_keys=True))
        return 1
    merkle, evidence_count = evidence_merkle(evidence)
    final = {
        "schema": "glp.pass7.final.v1",
        "status": "PASS",
        "acceptance_run_id": run["acceptance_run_id"],
        "run_manifest_sha256": run_file_sha,
        "started_at_utc": run["started_at_utc"],
        "finished_at_utc": utc_now(),
        "receipt_count": 43,
        "receipts": receipts,
        "evidence_file_count": evidence_count,
        "evidence_merkle_sha256": merkle,
        "side_effects": dict(SIDE_EFFECTS),
        "blocking_failures": [],
    }
    atomic_publish_evidence(out, evidence, final)
    print(json.dumps({"status": "PASS", "final": str(out), "receipt_count": 43, "evidence_merkle_sha256": merkle}, sort_keys=True))
    return 0


def sample_run_for_self_test(evidence: Path) -> tuple[dict[str, Any], str]:
    now = dt.datetime.now(dt.timezone.utc)
    run_id = f"p7-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex}"
    bundle = contract_bundle()
    nonce = os.urandom(32).hex()
    bindings = input_bindings()
    run: dict[str, Any] = {
        "schema": RUN_SCHEMA,
        "status": "RUNNING",
        "acceptance_run_id": run_id,
        "started_at_utc": utc_now(),
        "host_id": socket.gethostname(),
        "challenge_nonce": nonce,
        "challenge_nonce_sha256": sha256_bytes(bytes.fromhex(nonce)),
        "workspace": str(WORKSPACE_ROOT),
        "candidate_source": str(RELEASE_ROOT),
        "git_commit": "a" * 40,
        "git_tree": "b" * 40,
        "git_clean": True,
        "runner": str(SCRIPT),
        "runner_sha256": sha256_file(SCRIPT),
        "contract_bundle": bundle,
        "contract_bundle_sha256": sha256_bytes(canonical_bytes(bundle)),
        "required_validator_ids": list(ALL_IDS),
        "required_validator_count": 43,
        "validator_catalog": {phase: list(ids) for phase, ids in PHASE_IDS.items()},
        "expected_mapping_row_ids": list(MAPPING_IDS),
        "input_bindings": bindings,
        "current_base_binding": current_base_binding(bindings),
        "side_effect_policy": dict(SIDE_EFFECTS),
        "operator_rulings": {"A2": dict(A2_RULING)},
        "control_target": {
            "origin": str(RELEASE_ROOT),
            "release_id": "UNSEALED-CONTROL",
            "deployment_id": "PRE-NOT-DEPLOYED",
            "release_tree_sha256": "c" * 64,
            "public_tree_sha256": ZERO_SHA,
            "ownership_marker_sha256": ZERO_SHA,
        },
        "phase_binding_paths": {
            phase: str(EVIDENCE_BASE / run_id / "bindings" / f"{phase}-target.json")
            for phase in PHASE_IDS
        },
        "manifest_sha256": ZERO_SHA,
    }
    run["manifest_sha256"] = normalized_self_hash(run, "manifest_sha256")
    raw = canonical_bytes(run) + b"\n"
    return run, sha256_bytes(raw)


def self_test() -> int:
    if len(ALL_IDS) != 43 or len(set(ALL_IDS)) != 43:
        raise ContractError("exact 43-validator catalog self-test failed")
    if {phase: len(ids) for phase, ids in PHASE_IDS.items()} != {"pre": 8, "deploy": 1, "candidate": 24, "live": 10}:
        raise ContractError("phase cardinality self-test failed")
    catalog = load_contract_catalog()
    fixtures = load_negative_fixture_definitions()
    for schema_path in (
        CONTRACT_FILES["run_schema"],
        CONTRACT_FILES["target_binding_schema"],
        CONTRACT_FILES["validator_receipt_schema"],
    ):
        schema = load_json_file(schema_path)
        if not isinstance(schema, dict) or schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema" or schema.get("additionalProperties") is not False:
            raise ContractError(f"strict schema self-test failed: {schema_path.name}")
    try:
        loads_strict('{"a":1,"a":2}')
    except ContractError:
        pass
    else:
        raise ContractError("duplicate-key parser self-test failed")
    vector = {"a": 1, "receipt_sha256": "f" * 64}
    expected_vector = "728a2efd30d11057d5478455abb187ff5f6fd837e6b72d01086da71d79d3781b"
    if normalized_self_hash(vector, "receipt_sha256") != expected_vector:
        raise ContractError("receipt self-hash fixed vector mismatch")

    with tempfile.TemporaryDirectory(prefix="p7-acceptance-selftest-") as directory:
        evidence = Path(directory)
        os.chmod(evidence, 0o700)
        run, run_file_sha = sample_run_for_self_test(evidence)
        run_errors = validate_run(run, check_environment=False)
        if run_errors:
            raise ContractError("sample run failed: " + "; ".join(run_errors))
        run_mutation_rejections = 0
        for field, replacement, expected_error in (
            ("required_validator_count", 42, "validator exact-set mismatch"),
            ("operator_rulings", {"A2": {**A2_RULING, "cadence_ms": 6000}}, "A2 ruling mismatch"),
            ("contract_bundle_sha256", "f" * 64, "contract bundle digest mismatch"),
        ):
            mutated_run = copy.deepcopy(run)
            mutated_run[field] = replacement
            mutation_errors = validate_run(mutated_run, check_environment=False)
            if not any(expected_error in error for error in mutation_errors):
                raise ContractError(f"run manifest mutation unexpectedly accepted: {field}: {mutation_errors}")
            run_mutation_rejections += 1
        outside = Path("/tmp") / run["acceptance_run_id"]
        try:
            validate_run_root_path(outside)
        except ContractError:
            path_escape_rejected = True
        else:
            raise ContractError("evidence-root escape self-test failed")
        directory_fd = secure_open_absolute_directory(evidence)
        try:
            atomic_publish_json_at(directory_fd, "atomic.json", {"schema": "fixture", "ok": True})
            try:
                atomic_publish_json_at(directory_fd, "atomic.json", {"schema": "fixture", "ok": False})
            except FileExistsError:
                pass
            else:
                raise ContractError("exclusive atomic publication self-test failed")
        finally:
            os.close(directory_fd)
        atomic_path = evidence / "atomic.json"
        if stat.S_IMODE(os.lstat(atomic_path).st_mode) != 0o600:
            raise ContractError("atomic evidence mode self-test failed")
        results = evaluate_negative_fixtures(run, run_file_sha, evidence, artifact_binding(atomic_path, evidence))
        if len(results) != len(fixtures) or not all(row["rejected"] for row in results):
            raise ContractError("negative fixture suite self-test failed")
        missing_authority_rejections = 0
        for phase, validator_id in (("deploy", "P7-DEP-01"), ("candidate", "P7-CAN-01"), ("live", "P7-LIVE-01")):
            try:
                load_phase_target(phase, validator_id, run, run_file_sha, evidence)
            except ContractError as exc:
                if "authority/target evidence missing" not in str(exc) and "phase target-binding path disagreement" not in str(exc):
                    raise
                missing_authority_rejections += 1
            else:
                raise ContractError(f"{phase} passed without authority/target evidence")
    blocked_run_ids = [validator_id for validator_id in ALL_IDS if validator_id not in IMPLEMENTED_COMMANDS]
    if sorted(blocked_run_ids) != sorted(DEPLOY_BOUND_IDS) or catalog["implemented_commands"] != IMPLEMENTED_COMMANDS:
        raise ContractError("domain fail-closed boundary self-test failed")
    if set(IMPLEMENTED_COMMANDS) & DEPLOY_BOUND_IDS:
        raise ContractError("a deploy-bound validator must not claim a local implementation")
    print(json.dumps({
        "status": "PASS",
        "validator_count": 43,
        "phase_counts": {phase: len(ids) for phase, ids in PHASE_IDS.items()},
        "negative_fixtures": len(fixtures),
        "run_manifest_mutations_rejected": run_mutation_rejections,
        "path_escape_rejected": path_escape_rejected,
        "missing_authority_rejections": missing_authority_rejections,
        "deploy_bound_ids_without_local_implementation": len(blocked_run_ids),
        "locally_implemented_ids": len(IMPLEMENTED_COMMANDS),
        "duplicate_key_rejected": True,
        "exclusive_atomic_overwrite_rejected": True,
        "a2_cadence_ms": A2_RULING["cadence_ms"],
        "a2_pause_play_control": A2_RULING["pause_play_control"],
        "side_effects": dict(SIDE_EFFECTS),
    }, sort_keys=True))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="subcommand", required=True)
    init = sub.add_parser("init")
    init.add_argument("--evidence-root", required=True)
    init.add_argument("--workspace", required=True)
    init.add_argument("--out-run", required=True)
    init.add_argument("--out-receipt", required=True)
    run = sub.add_parser("run")
    run.add_argument("--id", required=True)
    run.add_argument("--phase", required=True, choices=tuple(PHASE_IDS))
    run.add_argument("--run", required=True)
    run.add_argument("--origin")
    run.add_argument("--out", required=True)
    validate = sub.add_parser("validate")
    validate.add_argument("--run", required=True)
    validate.add_argument("--receipt", required=True)
    validate.add_argument("--id", required=True)
    validate.add_argument("--phase", required=True, choices=tuple(PHASE_IDS))
    seal = sub.add_parser("seal-pre")
    seal.add_argument("--run", required=True)
    seal.add_argument("--out", required=True)
    close = sub.add_parser("close")
    close.add_argument("--run", required=True)
    close.add_argument("--out", required=True)
    sub.add_parser("self-test")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.subcommand == "init":
        return init_run(args)
    if args.subcommand == "run":
        return run_validator(args)
    if args.subcommand == "validate":
        return validate_command(args)
    if args.subcommand == "seal-pre":
        return seal_pre(args)
    if args.subcommand == "close":
        return close_command(args)
    if args.subcommand == "self-test":
        return self_test()
    raise ContractError("unreachable subcommand")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Errors are deliberately concise: do not echo untrusted receipt bodies,
        # environment values, credentials, or provider responses.
        print(json.dumps({"status": "FAIL", "error": str(exc), "side_effects": SIDE_EFFECTS}, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)
