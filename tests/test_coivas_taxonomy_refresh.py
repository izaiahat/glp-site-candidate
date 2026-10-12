"""GLP-320: renew wire-in evidence through the strict producer, not a clock edit."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Network is never available to CI; exercised only by the authorized live producer.
sys.modules.setdefault('affiliate_direct_evidence_capture', types.SimpleNamespace(_firecrawl_key=lambda: 'fixture-only'))
sys.modules.setdefault('firecrawl_client', types.SimpleNamespace(firecrawl_urlopen=None))
spec = importlib.util.spec_from_file_location('coivas_refresh', ROOT / 'scripts/refresh-therapeutic-taxonomy.py')
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class CoivasRefreshTest(unittest.TestCase):
    def test_wire_in_coivas_has_reviewed_official_unchanged_tag_policy(self):
        registry = json.loads((ROOT / 'data/program-registry.json').read_text())
        row = registry['therapeutic_taxonomy']['programs']['coivas']
        self.assertIn('coivas', refresh.POLICIES, 'wire-in Coivas must participate in maintained renewal')
        policy = refresh.POLICIES['coivas']
        self.assertEqual(policy['url'], 'https://www.coivas.com/challenge')
        expected = {field: list(policy['quotes'].get(field, {})) for field in refresh.FIELDS}
        self.assertEqual(expected, {field: row[field] for field in refresh.FIELDS})
        text = '\n'.join(quote for values in policy['quotes'].values() for quote in values.values())
        assertions = refresh.support(row, policy, text)
        self.assertEqual(set(assertions['molecule_tags']), {'semaglutide', 'tirzepatide'})
        self.assertEqual(set(assertions['treatment_type_tags']), {'compounded'})
        self.assertEqual(assertions['brand_name_tags'], {})
        with self.assertRaisesRegex(ValueError, 'assertion_no_longer_supported'):
            refresh.support(row, policy, 'Semaglutide and tirzepatide are mentioned, without the reviewed treatment assertion.')
        changed = copy.deepcopy(row)
        changed['brand_name_tags'] = ['wegovy']
        with self.assertRaisesRegex(ValueError, 'tag_set_changed'):
            refresh.support(changed, policy, text)
    def test_worktree_cli_resolves_explicit_business_root(self):
        import subprocess
        code = "import runpy,sys,types; sys.modules['affiliate_direct_evidence_capture']=types.SimpleNamespace(_firecrawl_key=None); sys.modules['firecrawl_client']=types.SimpleNamespace(firecrawl_urlopen=None); print(runpy.run_path('scripts/refresh-therapeutic-taxonomy.py')['BUSINESS'])"
        result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True,
            env={**os.environ, 'GLP_BUSINESS_ROOT': str(ROOT)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(ROOT))

    def test_capture_retains_exact_raw_response_bytes(self):
        import contextlib
        import io
        import tempfile
        from unittest.mock import patch
        raw = b'{"success": true, "data": {"markdown": "Official Coivas response", "metadata": {"statusCode": 200}}}\n'
        @contextlib.contextmanager
        def transport(request, **kwargs):
            response = io.BytesIO(raw)
            response.headers = {}
            yield response
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'coivas-primary.json'
            with patch.object(refresh, '_firecrawl_key', return_value='fixture-only'), patch.object(refresh, 'firecrawl_urlopen', transport, create=True), patch.object(refresh.urllib.request, 'urlopen', transport):
                receipt = refresh.capture('https://www.coivas.com/challenge', target)
            self.assertTrue(target.with_suffix('.raw.json').exists(), 'exact raw response must survive')
            self.assertEqual(target.with_suffix('.raw.json').read_bytes(), raw)
            self.assertEqual(receipt['response'], json.loads(raw))
            self.assertEqual(receipt['raw_response_sha256'], refresh.sha(raw))
            self.assertEqual(receipt['request']['maxAge'], 0)


if __name__ == '__main__':
    unittest.main()
