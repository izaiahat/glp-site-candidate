import importlib.util
from pathlib import Path
import unittest
SCRIPT=Path(__file__).resolve().parents[1]/'scripts/validate-data-attributes.py'
class DataAttributes(unittest.TestCase):
 def setUp(self):
  spec=importlib.util.spec_from_file_location('data_attributes_gate',SCRIPT)
  self.gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.gate)
 def test_actual_attributes_and_html_entities_are_checked(self):
  for token in ['undefined','null','NaN','SEMAGLUTIDE:undefined','{&quot;x&quot;:null}','&#117;ndefined']:
   with self.subTest(token=token):self.assertTrue(self.gate.invalid_data_attributes('<div data-price="'+token+'"></div>'))
 def test_quoted_unquoted_single_and_multiline_attributes(self):
  for markup in ['<div data-x=undefined>','<div data-x=\'null\'>','<div\ndata-x="NaN">','<noscript><div data-x="undefined"></div></noscript>']:
   with self.subTest(markup=markup):self.assertTrue(self.gate.invalid_data_attributes(markup))
 def test_nonattributes_and_similar_words_are_not_tokens(self):
  self.assertEqual(self.gate.invalid_data_attributes('<script>const x="<div data-x=undefined>";</script><!-- <div data-x=null> --><p>undefined null NaN</p><div data-ready data-x="nullable" data-y="0" data-z=""></div>'),[])
if __name__=='__main__':unittest.main()
