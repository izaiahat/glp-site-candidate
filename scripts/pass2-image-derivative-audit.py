#!/usr/bin/env python3
"""Build and verify the local-only PASS 2 image derivative receipt.

This script never calls a provider or the network. It inventories persisted
article, provider-logo, and product-render sources; emits responsive derivatives
only where a persisted raster source is large enough; and records hashes,
dimensions, alt text, focal points, provenance, duplicate checks, and honest
coverage gaps.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ARTICLE_MANIFEST = ROOT / "artifacts/ultracode/article-image-manifest.json"
ARTICLE_PROVENANCE = ROOT / "assets/source/article-masters/provenance.json"
PRODUCT_MANIFEST = ROOT / "artifacts/ultracode/phase3-product-renders/generated-image-lineage.json"
PROVIDER_MANIFEST = ROOT / "assets/provider-logos/manifest.json"
DERIVATIVE_ROOT = ROOT / "assets/derivatives/pass2"
PUBLIC_ROOT = ROOT / "public/assets/images/pass2"
MANIFEST = ROOT / "artifacts/ultracode/pass2-image-derivative-manifest.json"
FORMATS: dict[str, dict[str, Any]] = {
    "avif": {"quality": 64},
    "webp": {"quality": 80, "method": 6},
    "jpg": {"quality": 84, "optimize": True, "progressive": True},
}
ARTICLE_WIDTHS = (480, 960, 1600)
PRODUCT_WIDTHS = (480, 960)
REQUESTED_WIDTHS = (480, 960, 1600)

ARTICLE_SUBJECTS = {
    "access": "Abstract editorial care-access scene with a phone-shaped glass panel and blank process steps.",
    "compare": "Abstract editorial comparison scene with two blank glass evidence panels.",
    "coverage": "Abstract editorial coverage scene with layered blank documents and a shield motif.",
    "evidence": "Abstract editorial evidence scene with a chart line and blank document marks.",
    "pharmacy": "Abstract editorial pharmacy scene with a neutral container and blank evidence document.",
    "price": "Abstract editorial pricing scene with blank invoice lines and coin-like discs.",
    "wellness": "Abstract editorial wellness scene with layered glass forms.",
}
ARTICLE_ALTS = {
    "access": "Abstract phone and blank care-access steps.",
    "compare": "Two blank evidence panels arranged for comparison.",
    "coverage": "Blank coverage documents with a shield motif.",
    "evidence": "Blank evidence document with an abstract chart line.",
    "pharmacy": "Neutral pharmacy container beside a blank evidence document.",
    "price": "Blank invoice lines with abstract coin-like discs.",
    "wellness": "Layered abstract glass forms on a dark editorial background.",
}
PRODUCT_META = {
    "wegovy-pill": {
        "subject": "Original unbranded editorial tablet and blister-form still life.",
        "alt": "Unbranded tablet and blister-form editorial still life.",
    },
    "wegovy": {
        "subject": "Original unbranded editorial injection-device still life retained from Phase 3.",
        "alt": "Unbranded injection-device editorial still life for the Wegovy page.",
    },
    "ozempic": {
        "subject": "Original unbranded editorial injection-device still life retained from Phase 3.",
        "alt": "Unbranded injection-device editorial still life for the Ozempic page.",
    },
    "mounjaro": {
        "subject": "Original unbranded editorial injection-device still life retained from Phase 3.",
        "alt": "Unbranded injection-device editorial still life for the Mounjaro page.",
    },
    "zepbound": {
        "subject": "Original unbranded editorial injection-device still life retained from Phase 3.",
        "alt": "Unbranded injection-device editorial still life for the Zepbound page.",
    },
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def served_pass2_references() -> list[str]:
    """Return public HTML files that currently reference the Pass-2 audit derivative namespace."""
    references = []
    public = ROOT / "public"
    for html_path in public.rglob("*.html"):
        if "/assets/images/pass2/" in html_path.read_text(encoding="utf-8", errors="ignore"):
            references.append(str(html_path.relative_to(ROOT)))
    return sorted(references)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        image.load()
        return image.size


def clean_resize(source: Image.Image, width: int) -> Image.Image:
    if width > source.width:
        raise RuntimeError(f"upscale_refused:{source.width}->{width}")
    height = round(source.height * width / source.width)
    resized = source.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)
    clean = Image.new("RGB", resized.size)
    clean.paste(resized)
    return clean


def save_clean(image: Image.Image, path: Path) -> None:
    suffix = path.suffix[1:].lower()
    fmt = "JPEG" if suffix == "jpg" else suffix.upper()
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format=fmt, **FORMATS[suffix])


def duplicate_groups(rows: list[dict[str, Any]], hash_key: str = "sha256") -> list[dict[str, Any]]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        grouped[row[hash_key]].append(str(row.get("identity") or row.get("path") or row.get("name")))
    return [
        {"sha256": digest, "identities": sorted(identities)}
        for digest, identities in sorted(grouped.items())
        if len(set(identities)) > 1
    ]


def derivative_row(kind: str, identity: str, source: Path, image: Image.Image, width: int, extension: str) -> dict[str, Any]:
    framed = clean_resize(image, width)
    relative = Path(kind) / f"{identity}-{width}.{extension}"
    derivative = DERIVATIVE_ROOT / relative
    public = PUBLIC_ROOT / relative
    save_clean(framed, derivative)
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_bytes(derivative.read_bytes())
    return {
        "identity": f"{kind}:{identity}:{width}:{extension}",
        "path": str(derivative.relative_to(ROOT)),
        "public_path": str(public.relative_to(ROOT)),
        "format": extension,
        "width": framed.width,
        "height": framed.height,
        "bytes": derivative.stat().st_size,
        "sha256": sha256(derivative),
        "source_path": str(source.relative_to(ROOT)),
        "source_sha256": sha256(source),
    }


def build_article_inventory() -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    manifest = read_json(ARTICLE_MANIFEST)
    provenance = read_json(ARTICLE_PROVENANCE)
    if manifest.get("status") != "PASS" or provenance.get("status") != "PASS_VISUAL_QA":
        raise RuntimeError("article_input_manifest_not_passed")

    original_sources: list[dict[str, Any]] = []
    for master in provenance["masters"]:
        path = ROOT / master["path"]
        if not path.exists() or sha256(path) != master["sha256"]:
            raise RuntimeError(f"article_master_invalid:{path}")
        width, height = dimensions(path)
        original_sources.append({
            "identity": f"article-master:{master['category']}",
            "kind": "gpt_image_2_category_master",
            "category": master["category"],
            "path": master["path"],
            "sha256": master["sha256"],
            "width": width,
            "height": height,
            "provenance_manifest": str(ARTICLE_PROVENANCE.relative_to(ROOT)),
            "provider": provenance["generator"]["provider"],
            "model": provenance["generator"]["model"],
        })

    records: list[dict[str, Any]] = []
    derivatives: list[dict[str, Any]] = []
    underlying_routes: dict[str, list[str]] = defaultdict(list)
    subjects: dict[str, list[str]] = defaultdict(list)
    route_sources: list[dict[str, Any]] = []
    pinned_original_hashes: set[str] = set()

    for record in manifest["records"]:
        route = record["route"]
        stem = record["stem"]
        source_output = next(
            (row for row in record["outputs"] if row["width"] == 1600 and row["name"].endswith(".jpg")),
            None,
        )
        if not source_output:
            raise RuntimeError(f"article_1600_jpg_missing_from_manifest:{route}")
        source = ROOT / "assets/derivatives" / source_output["name"]
        if not source.exists() or sha256(source) != source_output["sha256"]:
            raise RuntimeError(f"article_route_source_invalid:{source}")
        source_width, source_height = dimensions(source)
        if (source_width, source_height) != (1600, 900):
            raise RuntimeError(f"article_route_source_dimensions_invalid:{source}")

        category = record.get("category", "wellness")
        subject = record.get("subject") or ARTICLE_SUBJECTS.get(category, ARTICLE_SUBJECTS["wellness"])
        alt = subject if record.get("disposition") == "generated_from_gpt_image_2_route_master" else ARTICLE_ALTS.get(category, ARTICLE_ALTS["wellness"])
        subjects[subject].append(route)
        underlying = record.get("master_path") or str(source.relative_to(ROOT))
        underlying_hash = record.get("master_sha256") or sha256(source)
        underlying_routes[underlying_hash].append(route)
        if record.get("disposition") == "inherited_phase6_pinned" and underlying_hash not in pinned_original_hashes:
            pinned_original_hashes.add(underlying_hash)
            original_sources.append({
                "identity": f"article-pinned:{stem}",
                "kind": "inherited_phase6_pinned_route_source",
                "category": category,
                "path": str(source.relative_to(ROOT)),
                "sha256": underlying_hash,
                "width": source_width,
                "height": source_height,
                "provenance_manifest": str(ARTICLE_MANIFEST.relative_to(ROOT)),
                "provider": "inherited_phase6",
                "model": "not_declared_in_pass2_inputs",
            })
        elif record.get("disposition") == "generated_from_gpt_image_2_route_master":
            master_path = ROOT / underlying
            if not master_path.exists() or sha256(master_path) != underlying_hash:
                raise RuntimeError(f"article_route_master_invalid:{route}")
            master_width, master_height = dimensions(master_path)
            original_sources.append({
                "identity": f"article-route-master:{stem}",
                "kind": "gpt_image_2_route_master",
                "category": category,
                "path": underlying,
                "sha256": underlying_hash,
                "width": master_width,
                "height": master_height,
                "provenance_manifest": str(ARTICLE_MANIFEST.relative_to(ROOT)),
                "provider": "Higgsfield",
                "model": "gpt_image_2",
                "prompt_sha256": record["prompt_sha256"],
                "subject": subject,
            })

        route_sources.append({
            "identity": f"article-route:{route}",
            "path": str(source.relative_to(ROOT)),
            "sha256": sha256(source),
            "width": source_width,
            "height": source_height,
        })
        with Image.open(source) as opened:
            opened.load()
            image = opened.convert("RGB").copy()
        output_rows = []
        for width in ARTICLE_WIDTHS:
            for extension in FORMATS:
                row = derivative_row("article", stem, source, image, width, extension)
                row.update({"route": route, "alt": alt, "subject": subject})
                output_rows.append(row)
                derivatives.append(row)
        records.append({
            "route": route,
            "stem": stem,
            "category": category,
            "subject": subject,
            "alt": alt,
            "focal_point": {
                "x": record.get("crop_x_bias", 0.5),
                "y": record.get("crop_y_bias", 0.5),
                "basis": "persisted route crop metadata; center fallback for inherited Phase-6 assets",
            },
            "route_source": route_sources[-1],
            "underlying_original_path": underlying,
            "underlying_original_sha256": underlying_hash,
            "derivatives": output_rows,
        })

    reuse_groups = [
        {"underlying_sha256": digest, "route_count": len(routes), "routes": sorted(routes)}
        for digest, routes in sorted(underlying_routes.items())
        if len(routes) > 1
    ]
    duplicate_subjects = [
        {"subject": subject, "route_count": len(routes), "routes": sorted(routes)}
        for subject, routes in sorted(subjects.items())
        if len(routes) > 1
    ]
    inventory = {
        "route_count": len(records),
        "route_intermediate_source_count": len(route_sources),
        "unique_route_intermediate_hashes": len({row["sha256"] for row in route_sources}),
        "underlying_original_count": len(original_sources),
        "unique_underlying_original_hashes": len({row["sha256"] for row in original_sources}),
        "unique_subject_description_count": len(subjects),
        "original_sources": original_sources,
        "underlying_source_reuse_groups": reuse_groups,
        "duplicate_subject_groups": duplicate_subjects,
        "records": records,
    }
    return inventory, derivatives, original_sources


def build_product_inventory() -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    manifest = read_json(PRODUCT_MANIFEST)
    if manifest.get("status") != "PASS":
        raise RuntimeError("product_input_manifest_not_passed")
    records = []
    derivatives = []
    sources = []
    gaps = []
    for source_row in manifest["sources"]:
        slug = source_row["slug"]
        source = ROOT / source_row["path"]
        if not source.exists() or sha256(source) != source_row["sha256"]:
            raise RuntimeError(f"product_source_invalid:{source}")
        width, height = dimensions(source)
        meta = PRODUCT_META[slug]
        canonical = {
            "identity": f"product:{slug}",
            "kind": "phase3_original_generated_render",
            "slug": slug,
            "path": source_row["path"],
            "sha256": source_row["sha256"],
            "width": width,
            "height": height,
            "provenance_manifest": str(PRODUCT_MANIFEST.relative_to(ROOT)),
            "provider": manifest["original_provider"],
            "model": manifest["original_model"],
        }
        sources.append(canonical)
        with Image.open(source) as opened:
            opened.load()
            image = opened.convert("RGB").copy()
        output_rows = []
        for target_width in PRODUCT_WIDTHS:
            for extension in FORMATS:
                row = derivative_row("product", slug, source, image, target_width, extension)
                row.update({"slug": slug, "alt": meta["alt"], "subject": meta["subject"]})
                output_rows.append(row)
                derivatives.append(row)
        gap = {
            "asset": f"product:{slug}",
            "requested_width": 1600,
            "source_width": width,
            "reason": "omitted_no_upscale_source_master_is_1024px",
        }
        gaps.append(gap)
        records.append({
            "slug": slug,
            "subject": meta["subject"],
            "alt": meta["alt"],
            "focal_point": {"x": 0.5, "y": 0.5, "basis": "Phase 3 centered square crop"},
            "source": canonical,
            "derivatives": output_rows,
            "omitted_widths": [gap],
        })
    return {
        "source_count": len(sources),
        "unique_source_hashes": len({row["sha256"] for row in sources}),
        "records": records,
    }, derivatives, sources, gaps


def build_provider_inventory() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = read_json(PROVIDER_MANIFEST)
    if manifest.get("status") != "PASS":
        raise RuntimeError("provider_logo_manifest_not_passed")
    records = []
    sources = []
    for logo in manifest["logos"]:
        local = ROOT / "assets/provider-logos" / logo["output_file"]
        public = ROOT / logo["public_path"].lstrip("/")
        expected = logo["output_sha256"]
        if not local.exists() or not public.exists() or sha256(local) != expected or sha256(public) != expected:
            raise RuntimeError(f"provider_logo_hash_mismatch:{logo['program_id']}")
        source = {
            "identity": f"provider:{logo['program_id']}",
            "kind": "verified_provider_registry_logo",
            "program_id": logo["program_id"],
            "provider": logo["provider"],
            "path": str(local.relative_to(ROOT)),
            "public_path": str(public.relative_to(ROOT)),
            "sha256": expected,
            "width": logo["width"],
            "height": logo["height"],
            "media_type": logo["media_type"],
            "source_kind": logo["source_kind"],
            "source_page_url": logo.get("source_page_url"),
            "source_asset_url": logo.get("source_asset_url"),
            "resolved_url": logo.get("resolved_url"),
            "verified_as_of": logo["verified_as_of"],
            "provenance_manifest": str(PROVIDER_MANIFEST.relative_to(ROOT)),
        }
        sources.append(source)
        records.append({
            "program_id": logo["program_id"],
            "alt": f"{logo['provider']} logo",
            "source": source,
            "derivative_disposition": "preserved_verified_registry_asset_no_photographic_transcoding",
        })
    return {
        "source_count": len(sources),
        "unique_source_hashes": len({row["sha256"] for row in sources}),
        "records": records,
    }, sources


def build() -> dict[str, Any]:
    article_inventory, article_derivatives, article_originals = build_article_inventory()
    product_inventory, product_derivatives, product_sources, product_gaps = build_product_inventory()
    provider_inventory, provider_sources = build_provider_inventory()
    canonical_originals = article_originals + product_sources + provider_sources
    canonical_derivatives = article_derivatives + product_derivatives
    original_duplicate_groups = duplicate_groups(canonical_originals)
    derivative_duplicate_groups = duplicate_groups(canonical_derivatives)
    mirror_mismatch_count = 0
    for row in canonical_derivatives:
        if sha256(ROOT / row["path"]) != sha256(ROOT / row["public_path"]):
            mirror_mismatch_count += 1
    article_uniqueness_gap = (
        article_inventory["underlying_original_count"] < article_inventory["route_count"]
        or article_inventory["unique_subject_description_count"] < article_inventory["route_count"]
    )
    gaps = [
        {
            "id": "article-original-subject-uniqueness",
            "severity": "release_blocker",
            "route_count": article_inventory["route_count"],
            "underlying_original_count": article_inventory["underlying_original_count"],
            "unique_subject_description_count": article_inventory["unique_subject_description_count"],
            "detail": "Persisted route intermediates are byte-unique, but most routes reuse six category masters and six honest category subject descriptions; route-specific original subjects do not exist in persisted inputs.",
            "resolution": "Generate and visually approve one original, text-free master per route, then rerun this local derivative audit.",
        }
    ] if article_uniqueness_gap else []
    gaps.extend(product_gaps)
    audit_status = "PASS" if not original_duplicate_groups and not derivative_duplicate_groups and mirror_mismatch_count == 0 else "FAIL"
    release_readiness = "BLOCKED_ARTICLE_SOURCE_UNIQUENESS" if article_uniqueness_gap else audit_status
    payload = {
        "schema": "gcs.pass2.image-derivative-audit.v1",
        "audit_status": audit_status,
        "release_readiness": release_readiness,
        "execution_mode": "candidate-local deterministic Pillow only; zero network/provider calls",
        "served_usage": {
            "disposition": "audit_only_unreferenced_by_public_html" if not served_pass2_references() else "served_or_partially_served_requires_complete_usage_audit",
            "html_reference_files": served_pass2_references(),
            "note": "The 480/960/1600 Pass-2 namespace is an audit inventory unless complete served-markup binding is separately proven.",
        },
        "requested_widths": list(REQUESTED_WIDTHS),
        "formats": list(FORMATS),
        "source_manifests": [
            {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)}
            for path in (ARTICLE_MANIFEST, ARTICLE_PROVENANCE, PRODUCT_MANIFEST, PROVIDER_MANIFEST)
        ],
        "inventory": {
            "article": article_inventory,
            "provider": provider_inventory,
            "product": product_inventory,
        },
        "derivative_summary": {
            "article_output_count": len(article_derivatives),
            "product_output_count": len(product_derivatives),
            "total_output_count": len(canonical_derivatives),
            "format_counts": {extension: sum(1 for row in canonical_derivatives if row["format"] == extension) for extension in FORMATS},
            "width_counts": {str(width): sum(1 for row in canonical_derivatives if row["width"] == width) for width in REQUESTED_WIDTHS},
            "public_mirror_count": len(canonical_derivatives),
            "public_mirror_mismatch_count": mirror_mismatch_count,
        },
        "duplicate_checks": {
            "canonical_original_count": len(canonical_originals),
            "unique_canonical_original_hashes": len({row["sha256"] for row in canonical_originals}),
            "cross_identity_original_duplicate_groups": original_duplicate_groups,
            "canonical_derivative_count": len(canonical_derivatives),
            "unique_canonical_derivative_hashes": len({row["sha256"] for row in canonical_derivatives}),
            "cross_identity_derivative_duplicate_groups": derivative_duplicate_groups,
            "expected_public_mirror_duplicates_excluded": len(canonical_derivatives),
        },
        "gaps": gaps,
        "commands": {
            "build": "python3 scripts/pass2-image-derivative-audit.py",
            "check": "python3 scripts/pass2-image-derivative-audit.py --check",
            "upstream_article_check": "python3 scripts/generate-article-imagery.py --check",
            "upstream_product_check": "python3 scripts/build-phase3-product-renders.py --check",
        },
    }
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload


def check_image_row(row: dict[str, Any]) -> None:
    derivative = ROOT / row["path"]
    public = ROOT / row["public_path"]
    for path in (derivative, public):
        if not path.exists() or sha256(path) != row["sha256"]:
            raise RuntimeError(f"pass2_derivative_hash_mismatch:{path}")
        with Image.open(path) as image:
            image.load()
            if image.size != (row["width"], row["height"]):
                raise RuntimeError(f"pass2_derivative_dimensions_mismatch:{path}")
            if image.getexif():
                raise RuntimeError(f"pass2_derivative_exif_present:{path}")
    if not row.get("alt", "").strip() or not row.get("subject", "").strip():
        raise RuntimeError(f"pass2_derivative_accessibility_metadata_missing:{row['identity']}")


def check() -> dict[str, Any]:
    if not MANIFEST.exists():
        raise RuntimeError("pass2_image_manifest_missing")
    payload = read_json(MANIFEST)
    if payload.get("schema") != "gcs.pass2.image-derivative-audit.v1":
        raise RuntimeError("pass2_image_manifest_schema_invalid")
    for source_manifest in payload["source_manifests"]:
        path = ROOT / source_manifest["path"]
        if not path.exists() or sha256(path) != source_manifest["sha256"]:
            raise RuntimeError(f"pass2_source_manifest_stale:{path}")
    derivative_rows = []
    for record in payload["inventory"]["article"]["records"]:
        if not record.get("alt", "").strip() or not record.get("subject", "").strip():
            raise RuntimeError(f"article_alt_or_subject_missing:{record['route']}")
        derivative_rows.extend(record["derivatives"])
    for record in payload["inventory"]["product"]["records"]:
        if not record.get("alt", "").strip() or not record.get("subject", "").strip():
            raise RuntimeError(f"product_alt_or_subject_missing:{record['slug']}")
        derivative_rows.extend(record["derivatives"])
    for record in payload["inventory"]["provider"]["records"]:
        if not record.get("alt", "").strip():
            raise RuntimeError(f"provider_alt_missing:{record['program_id']}")
        source = record["source"]
        if sha256(ROOT / source["path"]) != source["sha256"] or sha256(ROOT / source["public_path"]) != source["sha256"]:
            raise RuntimeError(f"provider_source_hash_mismatch:{record['program_id']}")
    for row in derivative_rows:
        check_image_row(row)
    duplicates = duplicate_groups(derivative_rows)
    if duplicates:
        raise RuntimeError(f"pass2_derivative_duplicate_hashes:{duplicates}")
    summary = payload["derivative_summary"]
    if len(derivative_rows) != summary["total_output_count"] or summary["public_mirror_mismatch_count"] != 0:
        raise RuntimeError("pass2_derivative_summary_invalid")
    if payload["audit_status"] != "PASS":
        raise RuntimeError(f"pass2_image_audit_failed:{payload['audit_status']}")
    if payload["release_readiness"] != "PASS":
        raise RuntimeError(f"pass2_release_readiness_not_pass:{payload['release_readiness']}")
    release_blockers = [gap for gap in payload.get("gaps", []) if gap.get("severity") == "release_blocker"]
    if release_blockers:
        raise RuntimeError(f"pass2_release_blockers_present:{release_blockers}")
    product_omissions = [
        gap for gap in payload.get("gaps", [])
        if gap.get("reason") == "omitted_no_upscale_source_master_is_1024px"
        and gap.get("requested_width") == 1600
        and gap.get("source_width") == 1024
    ]
    article_route_count = payload["inventory"]["article"]["route_count"]
    product_source_count = payload["inventory"]["product"]["source_count"]
    if len(payload.get("gaps", [])) != product_source_count or len(product_omissions) != product_source_count:
        raise RuntimeError("pass2_product_no_upscale_gap_disposition_invalid")
    expected_article_outputs = article_route_count * len(ARTICLE_WIDTHS) * len(FORMATS)
    expected_product_outputs = product_source_count * len(PRODUCT_WIDTHS) * len(FORMATS)
    if (summary.get("article_output_count") != expected_article_outputs
            or summary.get("product_output_count") != expected_product_outputs
            or summary.get("total_output_count") != expected_article_outputs + expected_product_outputs):
        raise RuntimeError("pass2_exact_derivative_counts_invalid")
    served_references = served_pass2_references()
    usage_disposition = (
        "audit_only_unreferenced_by_public_html"
        if not served_references
        else "served_or_partially_served_requires_complete_usage_audit"
    )
    if served_references:
        raise RuntimeError(f"pass2_served_usage_requires_complete_binding_audit:{served_references}")
    return {
        "audit_status": "PASS",
        "release_readiness": payload["release_readiness"],
        "served_usage_disposition": usage_disposition,
        "served_reference_files": served_references,
        "article_routes": payload["inventory"]["article"]["route_count"],
        "provider_sources": payload["inventory"]["provider"]["source_count"],
        "product_sources": payload["inventory"]["product"]["source_count"],
        "derivatives_checked": len(derivative_rows),
        "mirrors_checked": len(derivative_rows),
        "duplicate_derivative_hash_groups": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = check() if args.check else build()
    if args.check:
        print(json.dumps(result, sort_keys=True))
    else:
        print(json.dumps({
            "audit_status": result["audit_status"],
            "release_readiness": result["release_readiness"],
            **result["derivative_summary"],
        }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
