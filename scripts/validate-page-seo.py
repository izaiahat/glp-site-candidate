#!/usr/bin/env python3
"""Read-only exact metadata parity gate for the accepted 85-route source cohort."""
import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = None
        self.values = {'title': [], 'h1': [], 'meta': []}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('title', 'h1'):
            self.active = tag
            self.values[tag].append('')
        if tag == 'meta' and attrs.get('name', '').lower() == 'description':
            self.values['meta'].append(attrs.get('content', ''))

    def handle_endtag(self, tag):
        if tag == self.active:
            self.active = None

    def handle_data(self, value):
        if self.active:
            self.values[self.active][-1] += value


def verify(root, public=None):
    root = Path(root).resolve(strict=True)
    public = Path(public).resolve(strict=True) if public else root / 'public'
    contract = json.loads((root / 'data/page-seo-copy.json').read_text())
    routes = contract.get('routes')
    if contract.get('schema') != 'clinic-scout-page-seo-v1' or not isinstance(routes, dict) or len(routes) != 85:
        raise ValueError('page_seo_cohort_invalid')
    results = []
    for route, copy in routes.items():
        if not re.fullmatch(r'/(?:providers|reviews|pharmacies)/(?:[a-z0-9-]+/)?', route):
            raise ValueError('page_seo_route_invalid')
        if not isinstance(copy, dict) or set(copy) != {'title', 'h1', 'meta'} or any(not isinstance(v, str) or not v.strip() for v in copy.values()):
            raise ValueError('page_seo_copy_invalid')
        file = public / route.lstrip('/') / 'index.html'
        parser = Metadata()
        try:
            if file.is_symlink() or not file.resolve(strict=True).is_relative_to(public):
                raise ValueError('page_seo_path_escape')
            parser.feed(file.read_text())
            matches = {key: parser.values[key] == [value] for key, value in copy.items()}
            results.append({'route': route, 'matches': matches, 'pass': all(matches.values())})
        except (OSError, ValueError) as exc:
            results.append({'route': route, 'pass': False, 'error': str(exc)})
    return {'expected': len(routes), 'passed': sum(row['pass'] for row in results), 'rows': results}


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    cli.add_argument('--public', type=Path)
    args = cli.parse_args()
    receipt = verify(args.root, args.public)
    print(json.dumps(receipt, sort_keys=True))
    raise SystemExit(0 if receipt['expected'] == receipt['passed'] == 85 else 1)
