"""Ruling40: selected routes re-derive; all other records/assets stay untouched."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

SOURCE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('article_images_selective', SOURCE / 'scripts/generate-article-imagery.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class SelectiveGenerationTests(unittest.TestCase):
    def test_two_edited_routes_write_fourteen_variants_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            content = root / 'content.json'
            baseline = root / 'baseline'
            baseline.mkdir()
            articles = [{'canonical_path': f'/guides/{name}/', 'h1': name, 'conclusion': 'old'}
                        for name in ('first', 'second', 'untouched')]
            content.write_text(json.dumps({'articles': articles}))
            (baseline / content.name).write_bytes(content.read_bytes())
            manifest = root / 'manifest.json'
            prior = {'schema': 'fixture', 'source_files': [{'path': content.name, 'sha256': M.sha_file(content)}],
                     'records': [{'route': a['canonical_path'], 'outputs': [], 'retained': 'exact original record'} for a in articles]}
            manifest.write_text(json.dumps(prior))
            for article in articles[:2]:
                article['conclusion'] = 'edited'
            content.write_text(json.dumps({'articles': articles}))
            masters = root / 'masters.json'
            masters.write_text('{}')
            writes = []
            original_save = M.save_clean

            def record_save(image, target):
                writes.append(target.name)
                return original_save(image, target)

            values = dict(ROOT=root, CONTENT_FILES=(content,), MANIFEST=manifest,
                          DERIVATIVES=root / 'derivatives', PUBLIC=root / 'public',
                          MASTER_PROVENANCE=masters)
            with patch.multiple(M, **values), patch.object(M, 'load_master_provenance', return_value={}), \
                    patch.object(M, 'load_route_masters', return_value={}), \
                    patch.object(M, 'compose', return_value=(Image.new('RGB', (1600, 900), '#338866'), {})), \
                    patch.object(M, 'save_clean', side_effect=record_save):
                # The old producer has no selected path: its natural full run writes 21.
                import inspect
                if 'routes' not in inspect.signature(M.generate).parameters:
                    M.generate()
                else:
                    with self.assertRaisesRegex(RuntimeError, 'unselected_article_changed'):
                        M.generate([articles[0]['canonical_path']], baseline)
                    self.assertEqual(writes, [])
                    M.generate([a['canonical_path'] for a in articles[:2]], baseline)
            self.assertEqual(len(writes), 14)
            self.assertFalse(any('untouched' in name for name in writes))
            after = json.loads(manifest.read_text())
            self.assertEqual(after['records'][2], prior['records'][2])
            self.assertEqual(after['source_files'][0]['sha256'], M.sha_file(content))


if __name__ == '__main__':
    unittest.main()
