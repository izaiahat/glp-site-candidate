"""D2j generated-markup invariant. HTML attributes only; no raw script scans."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
TOKEN = re.compile(r'\b(?:undefined|null|NaN)\b')

class DataAttributeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.failures = []
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name.startswith('data-') and value is not None and TOKEN.search(value):
                self.failures.append({'tag': tag, 'attribute': name, 'value': value,
                                      'line': self.getpos()[0], 'tokens': TOKEN.findall(value)})
    handle_startendtag = handle_starttag

def invalid_data_attributes(markup):
    parser = DataAttributeParser()
    parser.feed(markup)
    parser.close()
    return parser.failures

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--root', type=Path, required=True)
    cli.add_argument('--receipt', type=Path)
    args = cli.parse_args()
    root = args.root.resolve(strict=True)
    pages, failures = [], []
    for file in sorted(root.rglob('*.html')):
        if file.is_symlink():
            raise ValueError('data_attribute_gate_symlink')
        raw = file.read_bytes()
        relative = file.relative_to(root).as_posix()
        pages.append({'path': relative, 'sha256': hashlib.sha256(raw).hexdigest()})
        failures.extend({'path': relative, **row} for row in invalid_data_attributes(raw.decode('utf-8')))
    if not pages:
        raise ValueError('data_attribute_gate_empty_corpus')
    receipt = {'schema': 'data-attribute-invariants-v1', 'status': 'FAIL' if failures else 'PASS',
               'html_files': len(pages), 'invalid_attributes': len(failures),
               'invalid_tokens': sum(len(row['tokens']) for row in failures),
               'pages': pages, 'failures': failures}
    if args.receipt:
        args.receipt.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({key:receipt[key] for key in ['schema','status','html_files','invalid_attributes','invalid_tokens']}))
    return int(bool(failures))

if __name__ == '__main__':
    raise SystemExit(main())
