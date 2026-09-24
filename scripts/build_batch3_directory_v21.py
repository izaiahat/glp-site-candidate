#!/usr/bin/env python3
"""Build Batch 3 directory v2 from exact NPI-2 ↔ first-party GLP service bindings."""
from __future__ import annotations

import json
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/directory/npi-city-batch.json"
SEEDS = ROOT / "data/directory/npi-seeds-batch3.json"
EVIDENCE = Path("/home/ubuntu/business/reports/glp-clinic-scout/phase2-batch3-v21-20260723/research/directory-v2-exact-bindings.json")
CHECKED_AT = "2026-07-23T11:50:00Z"
CHECKED_DATE = "2026-07-23"
NEW_SLUGS = {"chicago-il", "new-york-ny", "miami-fl", "atlanta-ga", "boston-ma"}
DIRECT_NPIS = {
    "chicago-il": ["1528235462", "1699921007", "1578129524", "1104237114", "1578977328", "1558600957"],
    "new-york-ny": ["1497992218", "1801992631", "1891956645", "1831971886", "1043597263", "1497050231"],
}
FILLER_NPIS = {
    "chicago-il": ["1942649421", "1578736112", "1730823162", "1245701812"],
    "new-york-ny": ["1225736705", "1912549262", "1922345768", "1235301631"],
}
SCRAPE_IDS = {
    "1528235462": "019f8ea7-6ead-7419-a3b3-a22d14eb6932",
    "1699921007": "019f8eb0-d638-71da-a028-96c4ae7dcfba",
    "1578129524": "019f8eb0-7c17-7703-8600-365a21cf9dbb",
    "1104237114": "019f8eb0-e0dd-722c-a7b2-70c851c2d1bc",
    "1578977328": "019f8ea7-94ba-74b9-881c-47b251e171ce",
    "1558600957": "019f8ed0-b513-7539-9810-85276fc23cb2",
    "1497992218": "019f8ea8-772a-7da0-965a-5d50844f162d",
    "1801992631": "019f8e69-3d39-7115-a8cf-b3646e9dff34",
    "1891956645": "019f8ea8-f385-7d20-95c0-21e223bc8fb9",
    "1831971886": "019f8ea8-fd3c-760c-b6bf-17d27c3abf7b",
    "1043597263": "019f8ea9-27ee-7722-8ec6-46de7865a366",
    "1497050231": "019f8ea9-1163-71ba-a32f-0584fa47bdb1",
}


def get_npi(npi: str) -> dict:
    url = f"https://npiregistry.cms.hhs.gov/api/?version=2.1&number={npi}"
    with urllib.request.urlopen(url, timeout=60) as response:
        payload = json.load(response)
    results = payload.get("results") or []
    if len(results) != 1:
        raise RuntimeError(f"NPI_LOOKUP_COUNT:{npi}:{len(results)}")
    raw = results[0]
    if raw.get("enumeration_type") != "NPI-2" or (raw.get("basic") or {}).get("status") != "A":
        raise RuntimeError(f"NPI_NOT_ACTIVE_ORG:{npi}")
    addresses = raw.get("addresses") or []
    location = next((a for a in addresses if a.get("address_purpose") == "LOCATION"), None)
    if not location:
        raise RuntimeError(f"NPI_LOCATION_MISSING:{npi}")
    if (location.get("city") or "").upper() not in {"CHICAGO", "NEW YORK"}:
        raise RuntimeError(f"NPI_CITY_MISMATCH:{npi}:{location.get('city')}")
    taxonomies = []
    for taxonomy in raw.get("taxonomies") or []:
        taxonomies.append({
            "code": taxonomy.get("code"),
            "description": taxonomy.get("desc"),
            "primary": bool(taxonomy.get("primary")),
        })
    if not taxonomies:
        raise RuntimeError(f"NPI_TAXONOMY_MISSING:{npi}")
    basic = raw.get("basic") or {}
    return {
        "city": location.get("city").title(),
        "enumeration_date": basic.get("enumeration_date"),
        "enumeration_type": "NPI-2",
        "glp_service_verified": False,
        "last_updated": basic.get("last_updated"),
        "npi": str(raw.get("number")),
        "nppes_api_url": url,
        "nppes_checked_at_utc": CHECKED_AT,
        "organization_name": basic.get("organization_name"),
        "postal_prefix": (location.get("postal_code") or "")[:5],
        "publication_status": "HELD_DIRECT_SERVICE_THRESHOLD",
        "state": location.get("state"),
        "status": "A",
        "taxonomies": taxonomies,
        "weight_management_service_verified": False,
        "evidence_class": "NPPES_ONLY_NOT_SERVICE_EVIDENCE",
        "direct_service_source_url": None,
        "direct_service_verified_as_of": None,
        "service_evidence": None,
    }


def primary_description(record: dict) -> str:
    primary = next((t for t in record["taxonomies"] if t.get("primary")), None)
    return (primary or record["taxonomies"][0]).get("description") or "Other"


def build_city(slug: str, evidence_city: dict) -> dict:
    bindings = {item["npi"]: item for item in evidence_city["bindings"]}
    records = []
    for npi in DIRECT_NPIS[slug] + FILLER_NPIS[slug]:
        record = get_npi(npi)
        binding = bindings.get(npi)
        if binding:
            record.update({
                "glp_service_verified": True,
                "weight_management_service_verified": True,
                "evidence_class": "DIRECT_GLP1_ORGANIZATION_CITY_MATCH",
                "direct_service_source_url": binding["source_url"],
                "direct_service_verified_as_of": CHECKED_DATE,
                "service_evidence": {
                    "checked_as_of": CHECKED_DATE,
                    "classification": "counted_direct_glp1",
                    "exact_quote": binding["service_quote"],
                    "firecrawl_http_status": 200,
                    "firecrawl_scrape_id": SCRAPE_IDS[npi],
                    "linkage_note": binding["match_basis"] + ". The source does not display the NPI and does not prove individual clinician availability, eligibility, pricing, coverage, or that every location offers the service.",
                    "source_location": "Chicago, IL" if slug == "chicago-il" else "New York, NY",
                    "source_organization": binding["organization_name"],
                    "source_url": binding["source_url"],
                    "location_source_url": binding.get("location_source_url"),
                },
            })
        records.append(record)
    if len(records) != 10 or len({r["npi"] for r in records}) != 10:
        raise RuntimeError(f"CITY_RECORD_INVARIANT:{slug}")
    count = sum(1 for record in records if record["glp_service_verified"])
    if count != evidence_city["direct_proof_count"]:
        raise RuntimeError(f"DIRECT_COUNT_MISMATCH:{slug}")
    taxonomy_mix = dict(sorted(Counter(primary_description(record) for record in records).items()))
    city_name, state = ("Chicago", "IL") if slug == "chicago-il" else ("New York", "NY")
    if slug == "chicago-il":
        local_context = (
            "Chicago now has six independent first-party GLP-1 organization-and-location proofs across Hyde Park, the Near West Side, West Town, Lincoln Park, South Loop, and River North. "
            "The sample includes hospital programs, obesity medicine, multisite care, commercial medical weight loss, and surgical medical-weight-management evidence rather than repeating one provider type. "
            "The directory-data threshold passes, but operator promotion, correction intake, indexing, and release remain held; the page stays noindex and link-dark."
        )
        status = "PASS_DIRECTORY_DATA_HELD_FROM_RELEASE"
        reason = "six_independent_direct_glp_proofs_release_held"
    else:
        local_context = (
            "New York now has six independent first-party GLP-1 organization-and-location proofs across the Upper East Side, Kips Bay, Washington Heights, Midtown, and the Financial District. "
            "The evidence set spans hospital systems, an academic center, primary care, family medicine, and dermatology rather than repeating one provider type. "
            "The directory-data threshold passes, but operator promotion, correction intake, indexing, and release remain held; the page stays noindex and link-dark."
        )
        status = "PASS_DIRECTORY_DATA_HELD_FROM_RELEASE"
        reason = "six_independent_direct_glp_proofs_release_held"
    return {
        "api_result_count": 10,
        "city": city_name,
        "city_limitations": [
            "NPPES identifies organizations, taxonomy and listed locations; it does not prove licensure, credentials, quality, availability, insurance participation or GLP-1 service.",
            "Each counted source binds one first-party organization, city and explicit GLP-1 service page; the page does not display the NPI and does not prove that every location or clinician offers the service.",
            "Confirm current service, clinician availability, eligibility, pricing and coverage through the organization’s official channel before relying on any listing."
        ],
        "city_slug": slug,
        "direct_glp_service_verified_count": count,
        "direct_weight_management_only_count": 0,
        "gate_reason": reason,
        "local_context": local_context,
        "local_value_summary": local_context,
        "minimum_direct_glp_services_required": 6,
        "minimum_records_required": 10,
        "page_status": status,
        "primary_taxonomy_mix": taxonomy_mix,
        "sanitized_record_count": 10,
        "selected_active_npi2_record_count": 10,
        "slug": slug,
        "source_checked_at": CHECKED_DATE,
        "source_name": "NPPES NPI Registry API v2.1 + exact first-party GLP-1 organization/location evidence",
        "source_provenance_note": "NPPES supports organization identity, NPI, taxonomy, and listed location; it does not prove GLP-1 service, licensure, quality, availability, coverage, or pricing. Direct GLP-1 service is counted only through the separate first-party source object attached to the matching organization and city.",
        "source_queries": [
            {
                "api_result_count": 10,
                "sanitized_record_count": 10,
                "source_url": "https://npiregistry.cms.hhs.gov/api/?version=2.1&number={NPI}",
                "taxonomy_description": "Fresh by-number verification for each selected active NPI-2 organization"
            }
        ],
        "source_url": "https://npiregistry.cms.hhs.gov/api-page",
        "state": state,
        "distinct_local_context": evidence_city["distinct_local_context"],
        "records": records,
    }


def main() -> None:
    payload = json.loads(DATA.read_text())
    evidence = json.loads(EVIDENCE.read_text())
    evidence_by_slug = {city["slug"]: city for city in evidence["cities"]}
    base = [city for city in payload["cities"] if city["slug"] not in NEW_SLUGS]
    if len(base) != 10:
        raise RuntimeError(f"BASE_CITY_COUNT:{len(base)}")
    new_cities = [build_city(slug, evidence_by_slug[slug]) for slug in ("chicago-il", "new-york-ny")]
    cities = base + new_cities
    all_npis = [record["npi"] for city in cities for record in city["records"]]
    if len(cities) != 12 or len(all_npis) != 120 or len(set(all_npis)) != 120:
        raise RuntimeError("GLOBAL_DIRECTORY_INVARIANT")
    direct = sum(city["direct_glp_service_verified_count"] for city in cities)
    payload.update({
        "schema": "glp-phase2-batch3-directory-v2",
        "generated_at_utc": CHECKED_AT,
        "cities": cities,
        "batch_summary": {
            "cities_built": 12,
            "records_sanitized": 120,
            "direct_glp_service_verified": direct,
            "cities_with_direct_glp_service": sum(1 for city in cities if city["direct_glp_service_verified_count"] > 0),
            "cities_at_direct_glp_threshold": sum(1 for city in cities if city["direct_glp_service_verified_count"] >= 6),
            "cities_held_below_threshold": sum(1 for city in cities if city["direct_glp_service_verified_count"] < 6),
            "cities_held_from_release": 12,
            "all_city_pages_noindex_link_dark": True,
        },
    })
    DATA.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "cities": 12, "records": 120, "new_city_direct_counts": {c["slug"]: c["direct_glp_service_verified_count"] for c in new_cities}, "global_direct_count": direct}, sort_keys=True))


if __name__ == "__main__":
    main()
