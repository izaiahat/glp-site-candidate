"""Actual combined catalog identity/body split; no media generation or encoding."""
import importlib.util
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('imagery', ROOT / 'scripts/generate-article-imagery.py')
assert SPEC is not None and SPEC.loader is not None
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
BASE = 'e52b7cb903ceaa77ff8d16f958a986398cf3abda'
RECEIPT = 'artifacts/ultracode/article-image-REBIND-7f3b9b7eca877071-12aa0e7c539a090e.json'

class CombinedImageryTests(unittest.TestCase):
    def test_actual_identity_warn_persists_while_hsa_body_only_is_nonstale(self):
        raw = subprocess.check_output(['git', 'show', BASE + ':data/blog/content-batch.json'], cwd=ROOT)
        self.assertEqual(M.sha_bytes(raw), '8d9643a68b158b3f44e967dd742fa10e9b83d51191204abd5b1e55b661e7ec24')
        before = {a['canonical_path']: a for a in json.loads(raw)['articles']}
        current = {a['canonical_path']: a for a in M.load_articles()}
        manifest = json.loads(M.MANIFEST.read_bytes())
        records = {r['route']: r for r in manifest['records']}
        receipt_bytes = (ROOT / RECEIPT).read_bytes()
        self.assertEqual(M.sha_bytes(receipt_bytes), '3ae3640fe5f767e7ee335f75719b3dbe8995dfe71012eea1cf6725b62de8027c')
        receipt = json.loads(receipt_bytes)
        health = '/guides/healthrx-vs-agelessrx/'
        hsa = '/guides/glp-1-hsa-fsa-reimbursement-evidence/'
        self.assertEqual(receipt['inputs_stale_routes'], [health])
        self.assertEqual(receipt['validation']['warnings'][0]['level'], 'WARN')
        self.assertEqual(receipt['after_manifest_sha256'], M.sha_file(M.MANIFEST))
        self.assertEqual(current[health]['status'], 'HELD_SOURCE_REVIEW_IDENTITY_CORRECTION')
        self.assertEqual(current[health]['evidence_review']['status'], 'STALE_AFTER_IDENTITY_CORRECTION_REVIEW_REQUIRED')
        self.assertEqual({k for k in set(before[hsa]) | set(current[hsa]) if before[hsa].get(k) != current[hsa].get(k)}, {'sections', 'sources'})
        for route, stale in [(health, True), (hsa, False)]:
            original = M.image_inputs(before[route])
            rebound = M.input_binding(original, M.image_inputs(current[route]))
            self.assertEqual(rebound['inputs_stale'], stale)
            for key, value in rebound.items():
                self.assertEqual(records[route][key], value)
            repeated = M.input_binding(records[route]['image_inputs'], M.image_inputs(current[route]))
            self.assertEqual(repeated, rebound)
            self.assertEqual(records[route]['title_sha256'], M.sha_bytes(original['h1'].encode()))
        self.assertEqual(set(records[health]['image_input_diff']), {'h1', 'primary_keyword'})
        self.assertEqual(records[hsa]['image_input_diff'], {})

if __name__ == '__main__':
    unittest.main(verbosity=2)
