"""Portable packet-producer contract; no sender, browser or network effects."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def producer():
    spec = importlib.util.spec_from_file_location('packet_producer', ROOT / 'scripts/glp327_sponsor_packet.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture(root):
    """Obviously synthetic fixture only; never delivered as sponsor evidence."""
    from PIL import Image
    site, business = root / 'site', root / 'business'
    site.mkdir(); business.mkdir()
    subprocess.run(['git', 'init', '-q', str(site)], check=True)
    module = producer()
    sources = {}
    rates=json.loads((ROOT/'data/sponsor-pricing.json').read_text())
    economics={'currency':rates['currency'],'initial_total':rates['initial'],'setup':rates['setup'],
               'initial_placement':rates['placement'],'term_hours':rates['termHours'],
               'optional_same_scope_renewal':rates['renewal'],'auto_charge':rates['autoCharge']}
    for relative in module.SOURCE_REQUIRED:
        p = site / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rates) if relative=='data/sponsor-pricing.json' else 'SYNTHETIC TEST SOURCE\n')
        sources[relative] = module.digest(p)
    subprocess.run(['git', '-C', str(site), 'add', '.'], check=True)
    subprocess.run(['git', '-C', str(site), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                    'commit', '-qm', 'synthetic fixture'], check=True)
    for relative, content in {
        'ops/sponsor-machine/campaign.json': json.dumps({'send_enabled':False,'packet_sha256':None,'pricing':economics}),
        'ops/sponsor-machine/copy.json': json.dumps({'pricing':economics,'variants':{v:[{'subject':'SYNTHETIC','body':'SYNTHETIC'} for _ in range(3)] for v in ('cold','established_affiliate')}}),
        'scripts/glp_sponsor_campaign.py': '# SYNTHETIC CURRENT SENDER\n',
        'scripts/glp_sponsor_readiness.py': '# SYNTHETIC CONTACT INTERFACE\n',
        'inbox_control_plane/control_plane.py': '# SYNTHETIC INBOX\n',
        'inbox_control_plane/sponsor_replies.py': '# SYNTHETIC REPLY INTERFACE\n',
        'ops/sponsor-machine/assets.json': '{"scripts/glp_sponsor_campaign.py":"obsolete"}',
        str(module.LEGACY / 'NUIMAGE-DRAFT.md'): 'SYNTHETIC DRAFT — DO NOT SEND',
        str(module.LEGACY / 'OUTREACH-AND-FOLLOWUPS.md'): 'SYNTHETIC OUTREACH — DO NOT SEND',
    }.items():
        p = business / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    checks = []
    for surface in module.SURFACES:
        for viewport, width, height in [('mobile', 390, 844), ('desktop', 1440, 1000)]:
            relative = f'captures/SYNTHETIC-{surface}-{viewport}.png'
            p = business / relative
            p.parent.mkdir(parents=True, exist_ok=True)
            Image.new('RGB', (width, height), color=(20, 60, 40)).save(p)
            checks.append({'surface': surface, 'viewport': viewport, 'width': width,
                           'height': height, 'status': 'PASS', 'viewportImage': relative,
                           'viewportImageSha256': module.digest(p), 'pageImage': relative,
                           'pageImageSha256': module.digest(p)})
    capture = business / 'CAPTURE.json'
    module.dump(capture, {'status':'PASS','source':'scoped-render','head':'synthetic',
                          'sourceHashes':sources,'checks':checks})
    return site, business, capture

class PacketProducerTests(unittest.TestCase):
    def test_retained_predecessor_cannot_accept_successor_prices(self):
        m=producer()
        cap=ROOT/'reports/ops/sponsor-clean-layout-20261003/copy/captures/CAPTURE.json'
        with self.assertRaisesRegex(ValueError,'missing shared site source bindings|capture source changed'):
            m.validate_capture(ROOT,ROOT,cap)

    def test_conflicting_economics_refuse_before_packet_creation(self):
        m=producer()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);site,business,cap=fixture(root)
            data=json.loads((business/'ops/sponsor-machine/copy.json').read_text())
            data['pricing']['initial_total']=200
            m.dump(business/'ops/sponsor-machine/copy.json',data)
            with self.assertRaisesRegex(ValueError,'economics disagree'):
                m.build_packet(site,business,cap,root/'packet')
            self.assertFalse((root/'packet').exists())

    def test_current_rendered_packet_has_maintained_producer(self):
        path = ROOT / 'scripts/glp327_sponsor_packet.py'
        self.assertTrue(path.is_file(), 'current rendered PDFs need a maintained producer, not an invented manifest')
        self.assertTrue(callable(producer().build_packet))

    def test_rebinds_actual_sender_and_embeds_exact_archive_without_live_mutation(self):
        from pypdf import PdfReader
        m = producer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, business, cap = fixture(root)
            before = {str(p.relative_to(business)):m.digest(p) for p in business.rglob('*') if p.is_file()}
            out = root / 'packet'
            result = m.build_packet(site, business, cap, out)
            manifest = json.loads(Path(result['installation_manifest']).read_text())
            self.assertEqual(manifest['scripts/glp_sponsor_campaign.py'], m.digest(business / 'scripts/glp_sponsor_campaign.py'))
            self.assertNotEqual(manifest['scripts/glp_sponsor_campaign.py'], 'obsolete')
            for relative, sha in manifest.items():
                self.assertEqual(m.digest(out / 'installation-proposal' / relative), sha)
            self.assertEqual(before, {str(p.relative_to(business)):m.digest(p) for p in business.rglob('*') if p.is_file()})
            archive = out / 'sponsor-review-packet.zip'
            self.assertEqual(PdfReader(out / 'sponsor-review-packet.pdf').attachments[archive.name], [archive.read_bytes()])
            with zipfile.ZipFile(archive) as z:
                self.assertEqual(len([p for p in z.namelist() if p.endswith('.png')]), 6)
                self.assertIn('exact-source/assets/site-p3.css', z.namelist())
                self.assertNotIn(str(m.LEGACY/'NUIMAGE-DRAFT.md'),z.namelist())
                self.assertIn('inbox_control_plane/sponsor_replies.py',z.namelist())
                review=z.read(str(m.LEGACY/'REVIEW.md')).decode()
                self.assertIn('$500 initial',review);self.assertNotIn('$200',review);self.assertNotIn('$100',review)
                self.assertEqual(z.read('glp327_sponsor_packet.py'), (ROOT/'scripts/glp327_sponsor_packet.py').read_bytes())
            self.assertEqual(result['sends'], 0)
            self.assertFalse(result['source']['operator_approval'])
            self.assertFalse(result['source']['installed'])
            with self.assertRaisesRegex(ValueError, 'already exists'):
                m.build_packet(site, business, cap, out)

    def test_refuses_changed_native_rendering_bytes_before_output(self):
        m = producer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, business, cap = fixture(root)
            (site / 'src/paid-promo.mjs').write_text('CHANGED')
            with self.assertRaisesRegex(ValueError, 'capture source changed'):
                m.build_packet(site, business, cap, root / 'packet')
            self.assertFalse((root / 'packet').exists())

    def test_refuses_changed_pixels_and_enabled_campaign_before_output(self):
        m = producer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, business, cap = fixture(root)
            data = json.loads(cap.read_text())
            data['checks'][0]['viewportImageSha256'] = 'incorrect'
            m.dump(cap, data)
            with self.assertRaisesRegex(ValueError, 'capture image changed'):
                m.build_packet(site, business, cap, root / 'packet')
            data['checks'][0]['viewportImageSha256'] = m.digest(business / data['checks'][0]['viewportImage'])
            m.dump(cap, data)
            m.dump(business / 'ops/sponsor-machine/campaign.json', {'send_enabled':True})
            with self.assertRaisesRegex(ValueError, 'disabled unapproved campaign'):
                m.build_packet(site, business, cap, root / 'packet')
            self.assertFalse((root / 'packet').exists())

    def test_refuses_missing_frame_or_unconfined_input(self):
        m = producer()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, business, cap = fixture(root)
            data = json.loads(cap.read_text())
            data['checks'].pop()
            m.dump(cap, data)
            with self.assertRaisesRegex(ValueError, 'exactly six'):
                m.validate_capture(site, business, cap)
            with self.assertRaisesRegex(ValueError, 'unconfined'):
                m.confined(business, '../site/src/paid-promo.mjs')

if __name__ == '__main__':
    unittest.main()
