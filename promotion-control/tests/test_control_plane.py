#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
BIN = ROOT / "promotion-control/bin"
sys.path.insert(0, str(BIN))

import control_lib as lib  # noqa: E402
import preview_deploy  # noqa: E402
import rollback  # noqa: E402
import validate_release  # noqa: E402
import verify_preview  # noqa: E402


class PromotionControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = lib.load_json(lib.RELEASE_MANIFEST)
        cls.surface = lib.load_json(lib.SURFACE_MANIFEST)
        cls.diff = lib.load_json(lib.DIFF_MANIFEST)
        cls.rollback = lib.load_json(lib.ROLLBACK_MANIFEST)

    def test_accepted_baseline_manifest_and_source_bytes_are_unchanged(self):
        manifest = lib.load_json(lib.BASELINE_MANIFEST)
        self.assertEqual(manifest["accepted_public_tree"]["sha256"], "1a706e89dbc6a4ef46bab8ee9fe98fdb8e2ba65f488bb7b291e82e07e1df0be5")
        for row in manifest["entries"]:
            path = lib.BASELINE / row["path"]
            self.assertEqual(f"{stat.S_IMODE(path.lstat().st_mode):04o}", row["mode"], row["path"])
            if row["kind"] == "directory":
                self.assertTrue(path.is_dir(), row["path"])
            elif row["kind"] == "symlink":
                self.assertEqual(hashlib.sha256(os.readlink(path).encode()).hexdigest(), row["sha256"], row["path"])
            else:
                self.assertEqual(lib.sha_file(path), row["sha256"], row["path"])
        self.assertEqual(lib.canonical_tree_sha(lib.BASELINE / "public"), ("1a706e89dbc6a4ef46bab8ee9fe98fdb8e2ba65f488bb7b291e82e07e1df0be5", 406))

    def test_binding_repair_is_exactly_ten_token_replacements(self):
        files = ["src/worker.mjs", "tests/playbook.test.mjs", "data/canonical-click-token-spec.json"]
        count = 0
        for rel in files:
            before = (lib.BASELINE / rel).read_bytes()
            after = (lib.CANDIDATE / rel).read_bytes()
            count += before.count(b"CLICK_MAP")
            self.assertEqual(after, before.replace(b"CLICK_MAP", b"GLP_DB"), rel)
            self.assertNotIn(b"CLICK_MAP", after)
        self.assertEqual(count, 10)
        worker = (lib.CANDIDATE / "src/worker.mjs").read_text()
        self.assertIn("env.GLP_DB.prepare", worker)
        self.assertIn('groundTruth: "GLP_DB"', worker)

    def test_release_surface_and_cross_manifest_hashes(self):
        lib.verify_surface(self.surface)
        lib.verify_self_hash(self.release)
        lib.verify_self_hash(self.diff)
        lib.verify_self_hash(self.rollback)
        self.assertEqual(self.release["candidate"]["tree_sha256"], self.surface["tree_sha256"])
        self.assertEqual(self.release["candidate"]["surface_manifest_sha256"], lib.sha_file(lib.SURFACE_MANIFEST))
        self.assertEqual(self.release["diff"]["sha256"], lib.sha_file(lib.DIFF_MANIFEST))
        self.assertEqual(self.release["rollback"]["sha256"], lib.sha_file(lib.ROLLBACK_MANIFEST))
        self.assertEqual(self.release["candidate"]["binding"], "GLP_DB")

    def test_no_raw_production_pages_deploy_surface(self):
        pattern = re.compile(r"pages\s+[\"']?,?\s*deploy[^\n]*--branch[\"']?,?\s*[\"']?main\b", re.I)
        inspected = []
        for path in lib.CANDIDATE.rglob("*"):
            if not path.is_file() or any(part in lib.EXCLUDED_PARTS for part in path.relative_to(lib.CANDIDATE).parts):
                continue
            if path.name == "package.json" or path.suffix in {".py", ".mjs", ".js"}:
                text = path.read_text(encoding="utf-8", errors="ignore")
                self.assertIsNone(pattern.search(text), str(path))
                inspected.append(path)
        self.assertGreater(len(inspected), 10)

    def test_browser_receipt_is_isolated_from_frozen_predecessor(self):
        config = (lib.CANDIDATE / "playwright.config.mjs").read_text()
        self.assertIn(str(lib.REPORT / "cross-device-playwright.json"), config)
        self.assertNotIn("operator-national-wow-20260723/money-template-p1-20260724/cross-device-playwright.json", config)

    def test_preview_main_rejected_and_plan_calls_no_subprocess(self):
        with self.assertRaisesRegex(ValueError, "preview_branch_rejected"):
            lib.validate_branch("main")
        command = preview_deploy.build_command()
        self.assertIn(lib.PREVIEW_BRANCH, command)
        self.assertNotIn("main", command)
        with mock.patch.object(preview_deploy.subprocess, "run") as run:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(preview_deploy.main([]), 0)
            run.assert_not_called()

    def test_rollback_is_executable_but_held_without_operator_authorization(self):
        self.assertFalse(self.rollback["automatic_rollback_authorized"])
        self.assertTrue(self.rollback["operator_authorization_required"])
        self.assertFalse(self.rollback["rollback_executed"])
        self.assertIn("--apply", self.rollback["rollback_command"])
        with mock.patch.object(rollback.urllib.request, "urlopen") as urlopen:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(rollback.main(["--manifest", str(lib.ROLLBACK_MANIFEST)]), 0)
            urlopen.assert_not_called()

    def test_all_effects_and_runtime_eligibility_are_held(self):
        self.assertTrue(lib.all_effects_held(self.release["effects"]))
        self.assertFalse(self.release["eligibility"]["production"]["eligible"])
        self.assertFalse(self.release["eligibility"]["affiliate_runtime"]["eligible"])
        self.assertEqual(self.release["eligibility"]["affiliate_runtime"]["live_programs"], 0)
        self.assertFalse(self.release["eligibility"]["capture_runtime"]["eligible"])
        self.assertIsNone(self.release["operator_promotion_receipt"])
        self.assertEqual(self.release["preview_receipt"]["status"], "MISSING_NOT_DEPLOYED")
        self.assertIsNone(self.release["preview_receipt"]["sha256"])

    def test_current_production_grammar_fails_closed_while_manifest_held(self):
        exact = f"PROMOTE GLP-P1 {self.release['manifest_sha256']}"
        with self.assertRaisesRegex(ValueError, "production_manifest_held"):
            validate_release.main(["--command", exact])
        with self.assertRaisesRegex(ValueError, "promotion_command_mismatch"):
            validate_release.main(["--command", "PROMOTE GLP-P1 " + "0" * 64])

    def test_post_preview_offline_fixture_is_deterministic_and_no_network(self):
        fixture = ROOT / "promotion-control/fixtures/offline-preview.json"
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "one.json"
            second = Path(tmp) / "two.json"
            with mock.patch.object(verify_preview.urllib.request, "urlopen") as urlopen:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(verify_preview.main(["--fixture", str(fixture), "--output", str(first)]), 0)
                    self.assertEqual(verify_preview.main(["--fixture", str(fixture), "--output", str(second)]), 0)
                urlopen.assert_not_called()
            self.assertEqual(first.read_bytes(), second.read_bytes())
            receipt = json.loads(first.read_text())
            self.assertEqual(receipt["status"], "PASS_READ_ONLY")
            self.assertEqual(receipt["effects"]["methods"], ["GET", "HEAD"])
            self.assertFalse(receipt["effects"]["deployment"])

    def test_successor_canary_control_updates_authority_without_touching_accepted_canary(self):
        successor = lib.load_json(lib.CANARY_SUCCESSOR)
        lib.verify_self_hash(successor)
        self.assertEqual(successor["predecessor_acceptance"]["status"], "ACCEPTED")
        self.assertIn("predecessor bytes only", successor["predecessor_acceptance"]["scope"])
        self.assertIsNone(successor["successor_true_fable_acceptance_receipt"])
        self.assertFalse(successor["canary_promotion_authorized"])
        self.assertTrue(lib.all_effects_held(successor["effects"]))
        self.assertEqual(successor["accepted_canary_bytes_unchanged"]["public_tree_sha256"], "7c337be64c9260c35a4a5ce5467d7e9779d8e7ed4d8acb3e667cef224460f0e9")


if __name__ == "__main__":
    unittest.main()
