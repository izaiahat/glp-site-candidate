"""Regression: normalize only four new atlas inputs, not shipped logo assets."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
S = importlib.util.spec_from_file_location('atlas', ROOT/'scripts/build-provider-logo-atlas.py')
A = importlib.util.module_from_spec(S)
S.loader.exec_module(A)

class FourProviderAtlasInputs(unittest.TestCase):
    def test_four_inputs_are_cell_sized_and_other_logos_are_pixel_identical(self):
        rows = json.loads(A.SOURCE_MANIFEST.read_text())['logos']
        ids = {'tyde-wellness-review','feelgood-review','instarx-review','retaclinic-review'}
        self.assertEqual(A.MAX_BYTES, 110_000)
        self.assertEqual({r['program_id'] for r in rows if r['program_id'] in ids}, ids)
        for row in rows:
            original = A.load_image(ROOT/row['public_path'].lstrip('/'),row['media_type'])
            result = A.atlas_input(row)
            if row['program_id'] in ids:
                self.assertLessEqual(result.width,120)
                self.assertLessEqual(result.height,51)
                self.assertIsNotNone(result.getcolors(maxcolors=256))
            else:
                self.assertEqual(result.size,original.size)
                self.assertEqual(result.tobytes(),original.tobytes())

if __name__ == '__main__':
    unittest.main()
