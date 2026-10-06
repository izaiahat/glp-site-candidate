#!/usr/bin/env python3
"""Build an OFFLINE sponsor review successor from sealed native site captures.

No build/browser/sender/install invocation; no activation, approval or network IO.
Dependencies for PDF production: Pillow, reportlab, pypdf. The installation
bundle is a PROPOSAL. Its assets manifest binds actual bytes for canonical
sender paths, but this command never writes those live paths.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import zipfile
from xml.sax.saxutils import escape

LEGACY = Path('reports/ops/sponsor-machine-20261003')
SURFACES = {'rate-card': 'rate-card.pdf', 'providers-sponsored-panel': 'placement-template.pdf',
            'paid-promo': 'promo-page-preview.pdf'}
SOURCE_REQUIRED = {'src/paid-promo.mjs', 'src/sponsor-placement-candidate.mjs',
                   'src/phase3-page-graph.mjs', 'assets/site-p3.css'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def confined(root, relative):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f'missing or unconfined input: {relative}')
    return path


def validate_capture(site_root, business_root, capture_path):
    cap = json.loads(Path(capture_path).read_text())
    if cap.get('status') != 'PASS' or cap.get('source') != 'scoped-render':
        raise ValueError('native scoped capture PASS required; not release acceptance')
    sources = cap.get('sourceHashes', {})
    if not SOURCE_REQUIRED.issubset(sources):
        raise ValueError('missing shared site source bindings')
    for relative, sha in sources.items():
        if digest(confined(site_root, relative)) != sha:
            raise ValueError(f'capture source changed: {relative}')
    checks = cap.get('checks', [])
    expected = {(s, v) for s in SURFACES for v in ('desktop', 'mobile')}
    if len(checks) != 6 or {(r['surface'], r['viewport']) for r in checks} != expected:
        raise ValueError('exactly six site-native desktop/mobile first screens required')
    for row in checks:
        if row.get('status') != 'PASS' or any(row.get(k) for k in
            ('failures', 'a11y', 'blockedOrigins', 'pageErrors')):
            raise ValueError('capture checks not clean')
        if (row['width'], row['height']) != ((390, 844) if row['viewport'] == 'mobile' else (1440, 1000)):
            raise ValueError('unexpected native viewport')
        for key in ('viewportImage', 'pageImage'):
            if digest(confined(business_root, row[key])) != row[key + 'Sha256']:
                raise ValueError(f'capture image changed: {row[key]}')
        for image in row.get('expandedImages', []):
            if digest(confined(business_root, image['path'])) != image['sha256']:
                raise ValueError('expanded image changed')
    return cap


def capture_pdf(path, rows, business_root, *, first_only=False):
    """Embed original pixels; no restyling or synthesized web content."""
    from PIL import Image
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
    c = canvas.Canvas(str(path), invariant=1, pageCompression=1)
    c.setTitle('GLP Clinic Scout — site-native sponsor proposal (not live)')
    c.setAuthor('GLP Clinic Scout')
    for row in rows:
        keys = ['viewportImage'] if first_only else ['viewportImage', 'pageImage']
        for key in keys:
            with Image.open(confined(business_root, row[key])) as image:
                width, height = image.size
                # Native viewport pages first. Full captures are paginated with
                # overlap so typography remains readable, not shrunk to one sheet.
                tile_height = height if key == 'viewportImage' else row['height']
                stride = tile_height if key == 'viewportImage' else tile_height - 64
                for top in range(0, height, stride):
                    tile = image.crop((0, top, width, min(top + tile_height, height)))
                    scale = 1 if row['viewport'] == 'mobile' else .5
                    size = (width * scale, tile.height * scale)
                    c.setPageSize(size)
                    c.drawImage(ImageReader(tile), 0, 0, width=size[0], height=size[1])
                    c.showPage()
                    if top + tile_height >= height:
                        break
    c.save()


def text_pdf(path, texts):
    """Plain internal operator review pages; outward art stays native pixels."""
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize = 12
    styles['BodyText'].leading = 17
    story = []
    for index, (title, text) in enumerate(texts):
        if index:
            story.append(PageBreak())
        story.append(Paragraph(escape(title), styles['Heading1']))
        for paragraph in text.split('\n\n'):
            story.append(Paragraph(escape(paragraph).replace('\n', '<br/>'), styles['BodyText']))
            story.append(Spacer(1, 8))
    SimpleDocTemplate(str(path), pagesize=(420, 720), rightMargin=22,
                      leftMargin=22, topMargin=24, bottomMargin=24).build(story)


def build_packet(site_root, business_root, capture_path, out, review_gate=None):
    site_root, business_root, out = map(lambda p: Path(p).resolve(), (site_root, business_root, out))
    if out.exists():
        raise ValueError('immutable successor output already exists')
    if out == business_root or out.is_relative_to(site_root):
        raise ValueError('output must be an independent report successor, not source')
    cap = validate_capture(site_root, business_root, capture_path)
    campaign_path = confined(business_root, 'ops/sponsor-machine/campaign.json')
    campaign = json.loads(campaign_path.read_text())
    if campaign.get('send_enabled') is not False or campaign.get('packet_sha256') is not None:
        raise ValueError('disabled unapproved campaign required')
    # Snapshot bytes before producing the attachment manifest. Recheck all at end.
    paths = ['scripts/glp_sponsor_campaign.py', 'ops/sponsor-machine/campaign.json',
             'ops/sponsor-machine/copy.json', str(LEGACY / 'NUIMAGE-DRAFT.md'),
             str(LEGACY / 'OUTREACH-AND-FOLLOWUPS.md')]
    pinned = {p: digest(confined(business_root, p)) for p in paths}
    old_manifest = json.loads(confined(business_root, 'ops/sponsor-machine/assets.json').read_text())
    out.mkdir(parents=True)
    bundle = out / 'installation-proposal'
    for relative in paths:
        dest = bundle / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(confined(business_root, relative), dest)
    assets = bundle / LEGACY / 'assets'
    assets.mkdir(parents=True)
    for surface, filename in SURFACES.items():
        rows = sorted((r for r in cap['checks'] if r['surface'] == surface),
                      key=lambda r: r['viewport'] != 'mobile')
        capture_pdf(assets / filename, rows, business_root)
    head = subprocess.check_output(['git', '-C', str(site_root), 'rev-parse', 'HEAD'], text=True).strip()
    identity = {'schema': 'glp327_offline_packet_v1', 'site_head': head,
                'capture_head': cap['head'], 'capture_manifest_sha256': digest(capture_path),
                'capture_source_hashes': cap['sourceHashes'], 'source_bindings_verified': True,
                'sender_sha256': pinned['scripts/glp_sponsor_campaign.py'],
                'previous_manifest_sender_sha256': old_manifest.get('scripts/glp_sponsor_campaign.py'),
                'send_enabled': False, 'installed': False, 'fable_acceptance': False,
                'operator_approval': False, 'deployed': False,
                'limits': 'Current exact rendering bytes; retained 2026-10-03 genuine scoped captures. PDFs produced now. Not a fresh browser run or release build.'}
    dump(out / 'SOURCE-IDENTITY.json', identity)
    shutil.copyfile(capture_path, out / 'CAPTURE.json')
    source_dir = out / 'exact-source'
    for relative in cap['sourceHashes']:
        dest = source_dir / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(confined(site_root, relative), dest)
    producer = Path(__file__).resolve()
    shutil.copyfile(producer, out / producer.name)
    identity['producer_sha256'] = digest(producer)
    dump(out / 'SOURCE-IDENTITY.json', identity)
    review = ('# Current sponsor proposal — personal approval required\n\n'
              'OFFLINE ONLY. No emails, drafts, payment collection, installation or activation.\n\n'
              '$200 initial 30-day pilot: $100 setup plus $100 placement/reporting. '
              '720 consecutive hours from verified activation. $100 affirmative same-scope renewal; '
              'no automatic renewal. US only; Fella and held providers excluded. '
              'One Sponsored directory panel plus one sponsored provider intro page, not two directory slots. '
              'Neutral Example Provider; no real sponsor or endorsed client. Independent rankings unchanged. '
              'No guaranteed audience, impressions, leads, sales or SEO.\n\n'
              'Attached rate-card.pdf, placement-template.pdf and promo-page-preview.pdf '
              'are current site-renderer captures, not live pages. All proposed sponsor routes remain undeployed.\n\n'
              'Nu Image draft and outreach/follow-ups are retained byte-identical for personal review, '
              'not approved or sent. Sender: partners@glpclinicscout.com. Registered job 3940adcf89f6 remains paused. '
              '25-message daily ceiling, weekday 09:00 America/Los_Angeles, follow-ups days 4/10. '
              'Any reply/bounce/opt-out/complaint or uncertain send stops the sequence.\n\n'
              'Required decisions: Izaiah approves exact rates, three attachments, campaign and Nu Image exact reply; '
              'designated Fable accepts unchanged native rendering through the existing exact-request route. '
              'Parent owns installation, source-hash readback and separate release authority. '
              'No permission for paid-panel creative/link/payment is inferred from affiliate approval.\n\n'
              f'Site PR20 rendering head: {head}. Capture manifest: {digest(capture_path)}.\n'
              f'Actual installed sender SHA: {pinned["scripts/glp_sponsor_campaign.py"]}. '
              'The generated installation-proposal manifest replaces the stale sender binding with these actual bytes; '
              'live assets.json is untouched. Parent must preserve predecessor evidence before any promotion.\n')
    review_dest = bundle / LEGACY / 'REVIEW.md'
    review_dest.write_text(review)
    manifest = {str(p.relative_to(bundle)): digest(p) for p in sorted(bundle.rglob('*')) if p.is_file()}
    dump(bundle / 'ops/sponsor-machine/assets.json', manifest)
    # First six review pages are genuine unscrolled mobile+desktop viewports.
    first = out / 'first-screens.pdf'
    rows = [r for s in SURFACES for v in ('mobile', 'desktop') for r in cap['checks']
            if (r['surface'], r['viewport']) == (s, v)]
    capture_pdf(first, rows, business_root, first_only=True)
    text = out / 'operator-copy.pdf'
    texts = [('Approval gates and proposed terms', review),
             ('Nu Image — exact unsent reply', (bundle / LEGACY / 'NUIMAGE-DRAFT.md').read_text()),
             ('Campaign — exact outreach and follow-ups', (bundle / LEGACY / 'OUTREACH-AND-FOLLOWUPS.md').read_text())]
    gate_files = []
    if review_gate is not None:
        gate = json.loads(Path(review_gate).read_text())
        if gate.get('fable_acceptance') is not False or gate.get('operator_approval') is not False:
            raise ValueError('this offline producer cannot import approvals')
        dump(out / 'REVIEW-GATE.json', gate)
        gate_files.append('REVIEW-GATE.json')
        texts.append(('Exact existing independent-review gate', json.dumps(gate, indent=2)))
        capacity_path = Path(review_gate).parent / 'CAPACITY.json'
        if capacity_path.is_file():
            shutil.copyfile(capacity_path, out / 'CAPACITY.json')
            gate_files.append('CAPACITY.json')
    text_pdf(text, texts)
    for relative, sha in pinned.items():
        if digest(confined(business_root, relative)) != sha:
            raise ValueError(f'input changed during packet production: {relative}')
    validate_capture(site_root, business_root, capture_path)
    archive = out / 'sponsor-review-packet.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(bundle.rglob('*')):
            if p.is_file():
                z.write(p, str(p.relative_to(bundle)))
        for filename in ('SOURCE-IDENTITY.json', 'CAPTURE.json', producer.name, *gate_files):
            z.write(out / filename, filename)
        for p in sorted(source_dir.rglob('*')):
            if p.is_file():
                z.write(p, str(p.relative_to(out)))
        images = {r[k] for r in cap['checks'] for k in ('viewportImage', 'pageImage')}
        images.update(i['path'] for r in cap['checks'] for i in r.get('expandedImages', []))
        for relative in sorted(images):
            z.write(confined(business_root, relative), relative)
    from pypdf import PdfReader, PdfWriter
    writer = PdfWriter()
    writer.append(first)
    writer.append(text)
    for filename in SURFACES.values():
        writer.append(assets / filename)
    writer.add_attachment(archive.name, archive.read_bytes())
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    pdf = out / 'sponsor-review-packet.pdf'
    with pdf.open('wb') as f:
        writer.write(f)
    reader = PdfReader(pdf)
    embedded = reader.attachments[archive.name]
    if len(embedded) != 1 or hashlib.sha256(embedded[0]).hexdigest() != digest(archive):
        raise ValueError('embedded archive verification failed')
    result = {'status': 'OFFLINE_COMPLETE_APPROVAL_REQUIRED', 'source': identity,
              'packet_sha256': digest(archive), 'pdf_sha256': digest(pdf), 'pages': len(reader.pages),
              'embedded_archive_verified': True, 'installation_manifest': str(bundle / 'ops/sponsor-machine/assets.json'),
              'installation_manifest_sha256': digest(bundle / 'ops/sponsor-machine/assets.json'),
              'attachments': {name: {'path': str(assets / name), 'sha256': digest(assets / name),
                                    'pages': len(PdfReader(assets / name).pages)} for name in SURFACES.values()},
              'sends': 0, 'gmail_drafts': 0, 'payment_activations': 0, 'site_releases': 0}
    dump(out / 'PACKAGING.json', result)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--site-root', type=Path, required=True)
    p.add_argument('--business-root', type=Path, required=True)
    p.add_argument('--capture-manifest', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--review-gate', type=Path)
    a = p.parse_args()
    print(json.dumps(build_packet(a.site_root, a.business_root, a.capture_manifest, a.out, a.review_gate), indent=2))

if __name__ == '__main__':
    main()
