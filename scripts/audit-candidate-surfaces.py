#!/usr/bin/env python3
"""Local full-surface provider-coverage audit for a BUILT release candidate.

Adapted 2026-08-13 from scripts/glp_full_surface_audit.py (bridge build) to run
against this candidate's built files instead of the live site, with one
correction the live auditor still needs: identity is compared on the CANONICAL
render identity. The eligibility file carries OFFER rows; registry
canonical_identity declarations (katalys-1516 "SHED" -> shedrx "Shed") merge
two offers of one merchant into one listing, so "shed present everywhere"
means present under its canonical identity — a second "SHED" row would be the
duplicate-merchant defect fixed on 2026-08-06, not coverage.

Checks:
  1. quiz pool == calculator dropdown == canonical live-eligible set EXACTLY
     (both directions; trt-nation and other non-live-eligible ids forbidden).
  2. shed present on every surface under canonical identity shedrx
     (compare row, quiz pool, calc dropdown, review via SHED-301 redirect,
     sitemap via the canonical review route).
  3. trt-nation absent from conversion pools, present editorially
     (compare + review + sitemap).
  4. measured fully de-linked: zero awinmid=126727 tracked links anywhere in
     public/, no /go/measured runtime entry, but still present link-dark on
     compare/quiz/calc/review/sitemap.
  5. Quiz indexation: no noindex (meta or _headers), route in sitemap,
     schema.org JSON-LD, indexable framing content, on-device privacy note.
  6. Count copy: every "N providers/programs" claim in the plausible range on
     key pages equals the true compare-surface merchant count.

Exit 0 only when every check passes. Run from the candidate root:
  python3 scripts/audit-candidate-surfaces.py [--out receipt.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
KEY_COPY_PAGES = [
    "index.html",
    "best/online-glp-1-providers/index.html",
    "glp-1-price-index/index.html",
    "quiz/provider-fit/index.html",
    "tools/glp-1-cost-calculator/index.html",
]


def read(relative: str) -> str:
    return (PUBLIC / relative).read_text(encoding="utf-8")


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    findings: list[dict] = []

    def finding(**kw):
        findings.append(kw)

    # ---- authority data ----
    elig = json.loads((ROOT / "data/program-page-eligibility.json").read_text())
    registry = json.loads((ROOT / "data/program-registry.json").read_text())
    by_any_id: dict[str, dict] = {}
    for program in registry["programs"]:
        by_any_id[program["program_id"]] = program
        if program.get("review_slug"):
            by_any_id[program["review_slug"]] = program

    def canonical_render_id(any_id: str) -> str:
        program = by_any_id.get(str(any_id))
        if not program:
            return str(any_id)
        declared = (program.get("profiles", {}).get("glp-clinic-scout", {})
                    .get("canonical_identity") or {})
        target = by_any_id.get(str(declared.get("canonical_program_id") or ""), program)
        return str(target.get("review_slug") or target["program_id"])

    live_rows = [row for row in elig["programs"]
                 if "live" in str(row.get("status") or "") or row.get("live_link_allowed") is True]
    live_ids = {str(row["program_id"]) for row in live_rows}
    live_canonical = {canonical_render_id(pid) for pid in live_ids}

    # ---- built surfaces ----
    best = read("best/online-glp-1-providers/index.html")
    quiz = read("quiz/provider-fit/index.html")
    calc = read("tools/glp-1-cost-calculator/index.html")
    sitemap = read("sitemap.xml")
    redirects = read("_redirects")
    headers = read("_headers")
    go_manifest = (ROOT / "functions/go/program-manifest.js").read_text()

    compare_names = set(re.findall(r'data-provider="([^"]+)"', best))
    compare_normed = {norm(name) for name in compare_names}
    quiz_rows = json.loads(re.search(r'id="candidate-data"[^>]*>(.*?)</script>', quiz, re.S).group(1))
    quiz_ids = {str(row["program_id"]) for row in quiz_rows}
    calc_ids = set(re.findall(r'<option value="([^"]+)"', calc)) - {""}
    calc_live = {str(row["program_id"]) for row in
                 json.loads(re.search(r"new Map\((\[.*?\])\.map", calc, re.S).group(1))}
    sitemap_routes = set(re.findall(r"<loc>https://glpclinicscout\.com(/[^<]*)</loc>", sitemap))
    name_by_pid = {str(row["program_id"]): str(row.get("display_name") or "") for row in quiz_rows}

    # ---- 1. conversion-pool parity, canonical, both directions ----
    quiz_canonical = {canonical_render_id(pid) for pid in quiz_ids}
    calc_canonical = {canonical_render_id(pid) for pid in calc_ids}
    for label, pool in (("quiz", quiz_canonical), ("calc_dropdown", calc_canonical)):
        for pid in sorted(live_canonical - pool):
            finding(check="pool_parity", surface=label, provider=pid, state="MISSING")
        for pid in sorted(pool - live_canonical):
            finding(check="pool_parity", surface=label, provider=pid, state="NOT_LIVE_ELIGIBLE")
    if quiz_canonical != calc_canonical:
        finding(check="pool_parity", state="QUIZ_CALC_DIVERGED",
                diff=sorted(quiz_canonical ^ calc_canonical))

    # ---- per-provider surface coverage (canonical) ----
    for pid in sorted(live_ids):
        render = canonical_render_id(pid)
        program = by_any_id.get(render, {})
        display = name_by_pid.get(render) or str(program.get("display_name") or "")
        if not ({norm(render), norm(display)} & compare_normed):
            finding(check="coverage", surface="compare", provider=pid, state="MISSING")
        review_path = f"/reviews/{render}/"
        own_slug = str(by_any_id.get(pid, {}).get("review_slug") or pid)
        own_review = f"/reviews/{own_slug}/"
        review_file = PUBLIC / review_path.strip("/") / "index.html"
        redirected = re.search(rf"^{re.escape(own_review)}\s+\S+\s+301", redirects, re.M)
        if not review_file.is_file() and not redirected:
            finding(check="coverage", surface="review", provider=pid, state="MISSING")
        if review_path not in sitemap_routes:
            finding(check="coverage", surface="sitemap", provider=pid, state="MISSING")

    # ---- 2. shed present everywhere under canonical identity ----
    shed_canonical = canonical_render_id("shed")
    shed = {
        "canonical_identity": shed_canonical,
        "compare": norm(name_by_pid.get(shed_canonical, shed_canonical)) in compare_normed,
        "quiz": shed_canonical in quiz_canonical,
        "calc_dropdown": shed_canonical in calc_canonical,
        "review_301": bool(re.search(r"^/reviews/shed/\s+/reviews/shedrx/\s+301", redirects, re.M)),
        "sitemap_canonical_review": f"/reviews/{shed_canonical}/" in sitemap_routes,
    }
    if shed_canonical == "shed":
        finding(check="shed", state="ALIAS_DECLARATION_MISSING")
    for surface, present in shed.items():
        if surface != "canonical_identity" and not present:
            finding(check="shed", surface=surface, state="MISSING")

    # ---- 3. trt-nation scoped out of pools, editorial elsewhere ----
    if "trt-nation" in quiz_ids or "trt-nation" in quiz.lower():
        finding(check="trt_nation", surface="quiz", state="UNEXPECTED_PRESENT")
    if "trt-nation" in calc_ids:
        finding(check="trt_nation", surface="calc_dropdown", state="UNEXPECTED_PRESENT")
    if norm("TRT Nation") not in compare_normed:
        finding(check="trt_nation", surface="compare", state="MISSING_EDITORIAL_ROW")
    if "/reviews/trt-nation/" not in sitemap_routes:
        finding(check="trt_nation", surface="sitemap", state="MISSING_EDITORIAL_REVIEW")

    # ---- 4. measured fully de-linked, still covered link-dark ----
    tracked = []
    for html_file in PUBLIC.rglob("*.html"):
        text = html_file.read_text(encoding="utf-8", errors="ignore")
        if "awinmid=126727" in text or "awclick.php?mid=126727" in text:
            tracked.append(str(html_file.relative_to(PUBLIC)))
    if tracked:
        finding(check="measured", state="TRACKED_LINK_PRESENT", files=sorted(tracked)[:20])
    if '"measured"' in go_manifest:
        finding(check="measured", surface="go", state="TRACKED_REDIRECT_PRESENT")
    for surface, pool in (("quiz", quiz_ids), ("calc_dropdown", calc_ids)):
        if "measured" not in pool:
            finding(check="measured", surface=surface, state="MISSING_LINK_DARK_ROW")
    if "measured" in calc_live:
        finding(check="measured", surface="calc_live_links", state="UNEXPECTED_LIVE")
    quiz_measured = next((row for row in quiz_rows if row["program_id"] == "measured"), None)
    if not quiz_measured or quiz_measured.get("has_live_link") or quiz_measured.get("affiliate_url"):
        finding(check="measured", surface="quiz", state="LIVE_LINK_LEAK")

    # ---- 5. quiz indexation ----
    robots = re.findall(r'name="robots" content="([^"]*)"', quiz)
    quiz_checks = {
        "meta_robots": robots[0] if robots else "",
        "noindex_meta": any("noindex" in value for value in robots),
        "noindex_header": bool(re.search(r"(?m)^/quiz[^\n]*\n(?:\s+[^\n]+\n)*?\s+X-Robots-Tag:.*noindex", headers)),
        "sitemap": "/quiz/provider-fit/" in sitemap_routes,
        "schema_jsonld": 'type="application/ld+json"' in quiz,
        "framing_content": "What this quiz does" in quiz and "What it does not do" in quiz,
        "privacy_note": "Your answers stay on your device" in quiz,
        "title": bool(re.search(r"<title>[^<]+</title>", quiz)),
        "meta_description": 'name="description"' in quiz,
        "canonical": 'rel="canonical" href="https://glpclinicscout.com/quiz/provider-fit/"' in quiz,
    }
    if quiz_checks["noindex_meta"] or quiz_checks["noindex_header"]:
        finding(check="quiz_indexation", state="NOINDEX_PRESENT")
    for key in ("sitemap", "schema_jsonld", "framing_content", "privacy_note",
                "title", "meta_description", "canonical"):
        if not quiz_checks[key]:
            finding(check="quiz_indexation", state=f"MISSING_{key.upper()}")

    # ---- 6. count copy ----
    true_compare_count = len(compare_names)
    count_claims: dict[str, list[int]] = {}
    for page in KEY_COPY_PAGES:
        html = read(page)
        claims = {int(n) for n in re.findall(
            r"\b(\d{1,3})\s+(?:online\s+)?(?:GLP[-‑ ]?1\s+)?(?:providers?|programs?)\b", html, re.I)}
        plausible = {n for n in claims if true_compare_count * 0.6 <= n <= true_compare_count * 1.4}
        count_claims[page] = sorted(plausible)
        for n in plausible:
            if n != true_compare_count:
                finding(check="count_copy", page=page, claimed=n, actual=true_compare_count)

    # ---- 7. dangling asset references (warning-only) ----
    # The accepted live head already ships 12 dangling srcset variants
    # (guide-cheapest-glp1 / guide-mounjaro-vs-ozempic-label-and-cost /
    # guide-zepbound-coupon families); they are recorded here so a REBUILD can
    # never silently add more, without failing the candidate for inherited debt.
    dangling: set[str] = set()
    for html_file in PUBLIC.rglob("*.html"):
        text = html_file.read_text(encoding="utf-8", errors="ignore")
        for ref in re.findall(r'(?:src|href|srcset)="(/assets/[^"\s]+)', text):
            for part in ref.split(","):
                path = part.strip().split(" ")[0].split("?")[0].split("#")[0]
                if path.startswith("/assets/") and not (PUBLIC / path.lstrip("/")).is_file():
                    dangling.add(path)

    receipt = {
        "schema": "glp.candidate_surface_audit.v1",
        "adapted_from": "scripts/glp_full_surface_audit.py",
        "audited_at_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidate": ROOT.name,
        "live_eligible_offer_rows": len(live_ids),
        "live_eligible_canonical_identities": len(live_canonical),
        "surface_counts": {
            "compare": len(compare_names),
            "quiz": len(quiz_ids),
            "calc_dropdown": len(calc_ids),
            "calc_live_links": len(calc_live),
            "sitemap_routes": len(sitemap_routes),
        },
        "shed": shed,
        "quiz_indexation": quiz_checks,
        "count_copy_claims": count_claims,
        "warnings": {"dangling_asset_refs": sorted(dangling)},
        "findings": findings,
        "status": "PASS" if not findings else "FAIL",
    }
    out = Path(args.out) if args.out else ROOT / "artifacts" / "candidate-surface-audit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, indent=1, sort_keys=True) + "\n")
    print(json.dumps({key: receipt[key] for key in
                      ("status", "live_eligible_canonical_identities", "surface_counts")},
                     sort_keys=True))
    for item in findings:
        print("FINDING:", json.dumps(item, sort_keys=True))
    print("receipt:", out)
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
