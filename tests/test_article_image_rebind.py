"""Real local-asset regression fixtures; never invoke an image generator."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('article_images', SOURCE / 'scripts/generate-article-imagery.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class SourceRebindTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.root = root
        self.baseline = root / 'baseline'
        manifest = json.loads((SOURCE / 'artifacts/ultracode/article-image-manifest.json').read_text())
        self.record = copy.deepcopy(manifest['records'][0])
        self.route = self.record['route']
        all_articles = M.load_articles()
        self.article = next(a for a in all_articles if a['canonical_path'] == self.route)
        files = [root / 'data/blog/a.json', root / 'data/blog/b.json']
        for index, file in enumerate(files):
            file.parent.mkdir(parents=True, exist_ok=True)
            data = {'articles': [self.article] if index == 0 else []}
            file.write_text(json.dumps(data))
            old = self.baseline / file.relative_to(root)
            old.parent.mkdir(parents=True, exist_ok=True)
            old.write_bytes(file.read_bytes())
        self.content = files[0]
        manifest.update(records=[self.record], article_count=1, output_count=7, route_master_count=1, external_generation_services_used=1)
        manifest['source_files'] = [{'path': str(p.relative_to(root)), 'sha256': M.sha_file(p)} for p in files]
        rels = [manifest['master_provenance']['path'], self.record['master_path']]
        provenance = json.loads((SOURCE / manifest['master_provenance']['path']).read_text())
        rels += [r['path'] for r in provenance['masters']]
        rels += [prefix + '/' + r['name'] for r in self.record['outputs'] for prefix in ['assets/derivatives', 'public/assets/images']]
        for rel in rels:
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SOURCE / rel, target)
        state = json.loads((SOURCE / M.ROUTE_MASTER_STATE_RELATIVE).read_text())
        state['records'] = {self.route: state['records'][self.route]}
        state_path = root / M.ROUTE_MASTER_STATE_RELATIVE
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps(state))
        manifest['route_master_state']['sha256'] = M.sha_file(state_path)
        self.manifest = root / 'artifacts/ultracode/article-image-manifest.json'
        self.manifest.write_text(json.dumps(manifest))
        self.original = copy.deepcopy(manifest)
        values = {'ROOT': root, 'CONTENT_FILES': tuple(files), 'MANIFEST': self.manifest,
                  'MASTER_DIR': root / 'assets/source/article-masters', 'MASTER_PROVENANCE': root / manifest['master_provenance']['path'],
                  'ROUTE_MASTER_DIR': root / 'assets/source/article-masters-pass2', 'ROUTE_MASTER_STATE': state_path,
                  'DERIVATIVES': root / 'assets/derivatives', 'PUBLIC': root / 'public/assets/images'}
        for name, value in values.items():
            p = patch.object(M, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.media = {str(p.relative_to(root)): M.sha_file(p) for p in root.rglob('*') if p.is_file() and p.suffix in ['.png', '.webp', '.avif', '.jpg']}

    def edit(self, **fields):
        data = json.loads(self.content.read_text())
        data['articles'][0].update(fields)
        self.content.write_text(json.dumps(data))

    def rebind(self, baseline=True):
        self.assertTrue(callable(getattr(M, 'rebind_sources', None)), 'source rebind mode missing')
        with patch.object(M, 'generate', side_effect=AssertionError('generation forbidden')), patch.object(M, 'compose', side_effect=AssertionError('composition forbidden')):
            return M.rebind_sources(self.baseline if baseline else None)

    def assert_media_unchanged(self):
        self.assertEqual(self.media, {r: M.sha_file(self.root / r) for r in self.media})

    def test_copy_only_rebind_preserves_masters_contracts_and_checks(self):
        self.edit(body_html='<p>Updated disclosure, no visual input change.</p>')
        receipt = self.rebind()
        self.assertEqual(receipt['rebound_routes'], [self.route])
        self.assertEqual(receipt['inputs_stale_routes'], [])
        self.assertNotEqual(receipt['before_manifest_sha256'], receipt['after_manifest_sha256'])
        self.assertEqual(M.check()['warnings'], [])
        new = json.loads(self.manifest.read_text())
        for key, value in self.record.items():
            self.assertEqual(new['records'][0][key], value, key)
        self.assert_media_unchanged()

    def test_changed_title_warns_and_remains_stale_after_repeat(self):
        self.edit(h1='A materially changed article subject')
        self.rebind()
        record = json.loads(self.manifest.read_text())['records'][0]
        self.assertTrue(record['inputs_stale'])
        self.assertIn('h1', record['image_input_diff'])
        self.assertEqual(record['title_sha256'], self.record['title_sha256'])
        checked = M.check()
        self.assertEqual(checked['status'], 'PASS')
        self.assertEqual(checked['warnings'][0]['route'], self.route)
        before = self.manifest.read_bytes()
        self.rebind(baseline=False)
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertTrue(json.loads(before)['records'][0]['inputs_stale'])
        self.assert_media_unchanged()

    def test_restored_original_input_clears_stale_not_master(self):
        self.edit(primary_keyword='different keyword')
        self.rebind()
        self.edit(primary_keyword=self.article.get('primary_keyword'))
        self.rebind(baseline=False)
        self.assertEqual(M.check()['warnings'], [])
        self.assert_media_unchanged()

    def test_missing_or_tampered_baseline_does_not_self_certify(self):
        # First binding needs an UNBOUND generation record, not records[0]
        # from the already-bound current manifest used by the repeat/WARN tests.
        preimage_sha = 'abfcc41435f896df48c68452c59c797c430841a2154149d673b5097e3f6b9af5'
        preimage = SOURCE / f'artifacts/ultracode/article-image-manifest-before-{preimage_sha}.json'
        self.assertEqual(M.sha_file(preimage), preimage_sha)
        manifest = json.loads(preimage.read_text())
        unbound = next(r for r in manifest['records'] if r['route'] == '/guides/ezra-glp-1-reviews/')
        fields = ('image_inputs', 'image_inputs_sha256', 'current_image_inputs',
                  'current_image_inputs_sha256', 'image_input_diff', 'inputs_stale')
        self.assertTrue(all(key not in unbound for key in fields))
        files = []
        for pin in manifest['source_files']:
            original = subprocess.check_output(
                ['git', 'show', f"e52b7cb903ceaa77ff8d16f958a986398cf3abda:{pin['path']}"], cwd=SOURCE)
            self.assertEqual(M.sha_bytes(original), pin['sha256'])
            historical = self.baseline / pin['path']
            current = self.root / pin['path']
            historical.parent.mkdir(parents=True, exist_ok=True)
            current.parent.mkdir(parents=True, exist_ok=True)
            historical.write_bytes(original)
            current.write_bytes(original)
            files.append(current)
        changed = json.loads(files[0].read_text())
        article = next(a for a in changed['articles'] if a['canonical_path'] == unbound['route'])
        self.assertEqual(M.sha_bytes(article['h1'].encode()), unbound['title_sha256'])
        article['h1'] = 'changed'
        files[0].write_text(json.dumps(changed))
        self.manifest.write_bytes(preimage.read_bytes())
        before = self.manifest.read_bytes()
        snapshot = lambda: {str(p.relative_to(self.root)): M.sha_file(p)
                            for p in self.root.rglob('*') if p.is_file()}
        self.assertTrue(callable(getattr(M, 'rebind_sources', None)))
        with patch.object(M, 'CONTENT_FILES', tuple(files)):
            untouched = snapshot()
            with self.assertRaisesRegex(RuntimeError, 'baseline'):
                M.rebind_sources(None)
            self.assertEqual(snapshot(), untouched, 'missing baseline: no manifest, receipt or media writes')
            self.assertEqual(self.manifest.read_bytes(), before)
            self.assert_media_unchanged()
            (self.baseline / manifest['source_files'][0]['path']).write_text('{}')
            untouched = snapshot()
            with self.assertRaisesRegex(RuntimeError, 'baseline'):
                M.rebind_sources(self.baseline)
            self.assertEqual(snapshot(), untouched, 'tampered baseline: no manifest, receipt or media writes')
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assert_media_unchanged()

    def test_corrupt_asset_still_fails_without_rebinding_manifest(self):
        file = self.root / 'assets/derivatives' / self.record['outputs'][0]['name']
        file.write_bytes(b'corrupt TEST fixture')
        before = self.manifest.read_bytes()
        self.assertTrue(callable(getattr(M, 'rebind_sources', None)))
        with self.assertRaisesRegex(RuntimeError, 'hash_mismatch'):
            M.rebind_sources(self.baseline)
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_stale_flag_cannot_hide_unbound_title_change(self):
        self.rebind()
        self.edit(h1='unbound title')
        manifest = json.loads(self.manifest.read_text())
        manifest['source_files'][0]['sha256'] = M.sha_file(self.content)
        manifest['records'][0]['inputs_stale'] = True
        self.manifest.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'input'):
            M.check()


if __name__ == '__main__':
    unittest.main(verbosity=2)
