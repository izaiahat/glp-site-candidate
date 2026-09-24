#!/usr/bin/env python3
"""Merge five taxonomy-focused NPPES metros into held Phase 2 Batch 2 staging."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITY_BATCH = ROOT / "data/directory/npi-city-batch.json"
SEEDS = ROOT / "data/directory/npi-seeds-batch2.json"
GENERATED_AT_UTC = "2026-07-23T07:35:13Z"
AS_OF = "2026-07-23"

SERVICE_EVIDENCE = {
    "1639973761": {
        "classification": "weight_management_only",
        "source_url": "https://www.phoenixmetabolichealth.com/",
        "source_organization": "Phoenix Metabolic Health",
        "source_location": "Phoenix, AZ",
        "exact_quote": "We provide comprehensive primary care, metabolic health services, chronic disease management, and specialized obesity medicine for effective weight loss.",
        "firecrawl_scrape_id": "019f8de5-a2f9-7279-8a44-1cb31cad8f90",
        "firecrawl_http_status": 200,
        "checked_as_of": AS_OF,
        "linkage_note": "Exact organization and city match; page verifies obesity/weight-management care but did not explicitly state GLP-1 service, so it is not counted toward the GLP-1 threshold.",
    },
    "1821157579": {
        "classification": "counted_direct_glp1",
        "source_url": "https://www.austinregionalclinic.com/services/healthiness-program/medication-and-lifestyle-program",
        "source_organization": "Austin Regional Clinic",
        "source_location": "Austin, TX",
        "exact_quote": "cutting-edge medications, including oral and injectable GLP-1 medications",
        "firecrawl_scrape_id": "019f8de5-b397-761b-9f34-14e3905f3bc2",
        "firecrawl_http_status": 200,
        "checked_as_of": AS_OF,
        "linkage_note": "Exact organization and city match; source does not display the NPI or prove service at every ARC location.",
    },
    "1760140404": {
        "classification": "counted_direct_glp1",
        "source_url": "https://www.medisliminc.com/blog/weight-loss-clinic-serving-spring-valley-medislim",
        "source_organization": "Medi-Slim Weight Loss & Spa",
        "source_location": "Las Vegas, NV",
        "exact_quote": "Medi-Slim Weight Loss & Spa is in Las Vegas, serving Spring Valley patients... We offer compounded semaglutide and compounded tirzepatide... tailored to your situation at your consultation.",
        "firecrawl_scrape_id": "019f8de5-c33a-70a6-95dd-f6cd9860e96f",
        "firecrawl_http_status": 200,
        "checked_as_of": AS_OF,
        "linkage_note": "Exact organization and Las Vegas match; source does not display the NPI. Compounded products are not FDA-approved.",
    },
}

CITY_CONTEXT = {
    "phoenix-az": "Phoenix’s held sample deliberately mixes active organization records returned through obesity medicine, endocrinology, family medicine and internal-medicine NPPES queries. One organization has a first-party obesity-care match, but no explicit GLP-1 service match was counted.",
    "denver-co": "Denver’s held sample combines active organization records returned through obesity medicine, endocrinology, family medicine and internal-medicine NPPES queries. No organization receives a direct GLP-1 flag because the bounded first-party search did not establish one.",
    "austin-tx": "Austin’s held sample combines active organization records returned through obesity medicine, endocrinology, family medicine and internal-medicine NPPES queries. One Austin Regional Clinic record has a conservative first-party GLP-1 program match; nine records remain registry-only.",
    "dallas-tx": "Dallas’s held sample combines active organization records returned through obesity medicine, endocrinology, family medicine and internal-medicine NPPES queries. No record receives a direct GLP-1 flag because bounded searches did not establish an exact first-party organization-and-service match.",
    "las-vegas-nv": "Las Vegas’s held sample combines active organization records returned through obesity medicine, endocrinology, family medicine and internal-medicine NPPES queries. One Medi-Slim record has a conservative first-party GLP-1 service match; all others remain registry-only.",
}

LIMITATIONS = [
    "NPPES identifies organizations, taxonomy and listed locations; it does not prove licensure, credentials, quality, availability, insurance participation or GLP-1 service.",
    "A first-party service page may establish an organization-and-city service match without displaying the NPI; it does not prove that every location under the organization offers that service.",
    "Use the organization’s official scheduling channel to confirm current service, clinician availability, eligibility, pricing and coverage before relying on the listing.",
]


def primary_mix(records: list[dict]) -> dict[str, int]:
    counts = Counter(
        taxonomy["description"]
        for record in records
        for taxonomy in record.get("taxonomies", [])
        if taxonomy.get("primary")
    )
    return dict(sorted(counts.items()))


def normalize_record(record: dict) -> dict:
    item = dict(record)
    evidence = SERVICE_EVIDENCE.get(item["npi"])
    item.update(
        {
            "nppes_api_url": f"https://npiregistry.cms.hhs.gov/api/?version=2.1&number={item['npi']}",
            "nppes_checked_at_utc": GENERATED_AT_UTC,
            "publication_status": "HELD_DIRECT_SERVICE_THRESHOLD",
            "direct_service_source_url": evidence["source_url"] if evidence and evidence["classification"] == "counted_direct_glp1" else None,
            "direct_service_verified_as_of": AS_OF if evidence and evidence["classification"] == "counted_direct_glp1" else None,
            "glp_service_verified": bool(evidence and evidence["classification"] == "counted_direct_glp1"),
            "weight_management_service_verified": bool(evidence),
            "evidence_class": (
                "DIRECT_GLP1_ORGANIZATION_CITY_MATCH"
                if evidence and evidence["classification"] == "counted_direct_glp1"
                else "DIRECT_WEIGHT_MANAGEMENT_GLP1_NOT_ESTABLISHED"
                if evidence
                else "NPPES_IDENTITY_TAXONOMY_LOCATION_ONLY"
            ),
            "service_evidence": evidence,
        }
    )
    return item


def main() -> None:
    existing = json.loads(CITY_BATCH.read_text())
    seeds = json.loads(SEEDS.read_text())
    existing_slugs = {city["slug"] for city in existing["cities"]}
    new_cities = []
    for seed in seeds["cities"]:
        slug = seed["city_slug"]
        if slug in existing_slugs:
            raise RuntimeError(f"city_collision:{slug}")
        records = [normalize_record(record) for record in seed["records"][:10]]
        if len(records) != 10 or len({record["npi"] for record in records}) != 10:
            raise RuntimeError(f"record_count_or_duplicate:{slug}")
        mix = primary_mix(records)
        if len(mix) < 2:
            raise RuntimeError(f"taxonomy_mix_thin:{slug}")
        direct = sum(record["glp_service_verified"] for record in records)
        weight_only = sum(record["weight_management_service_verified"] and not record["glp_service_verified"] for record in records)
        new_cities.append(
            {
                "city": seed["city"],
                "state": seed["state"],
                "slug": slug,
                "city_slug": slug,
                "source_name": seed["source_name"],
                "source_queries": seed["source_queries"],
                "selected_active_npi2_record_count": 10,
                "minimum_records_required": 10,
                "minimum_direct_glp_services_required": 6,
                "direct_glp_service_verified_count": direct,
                "direct_weight_management_only_count": weight_only,
                "page_status": "HELD_DIRECT_SERVICE_THRESHOLD",
                "gate_reason": "direct_glp_service_verification_minimum_not_met",
                "primary_taxonomy_mix": mix,
                "local_context": CITY_CONTEXT[slug],
                "local_value_summary": CITY_CONTEXT[slug],
                "city_limitations": LIMITATIONS,
                "records": records,
            }
        )

    output = dict(existing)
    output["cities"] = existing["cities"] + new_cities
    all_npis = [record["npi"] for city in output["cities"] for record in city["records"]]
    if len(output["cities"]) != 10 or len(all_npis) != 100 or len(set(all_npis)) != 100:
        raise RuntimeError("global_city_or_npi_count_invalid")
    output.update(
        {
            "schema": "glp-clinic-scout-phase2-batch2-npi-city-batch-v2",
            "generated_at_utc": GENERATED_AT_UTC,
            "selection_method": "Ten active NPI-2 organizations per city. Batch 2 uses deterministic round-robin selection across official NPPES obesity medicine, endocrinology, family medicine and internal-medicine queries; taxonomy is never treated as service proof. First-party pages are counted separately only with organization/city linkage and explicit service wording.",
            "global_data_limitations": [
                "NPI issuance does not ensure or validate licensure or credentials.",
                "NPPES taxonomy and address data do not prove GLP-1 prescribing or weight-management services.",
                "Direct-service verification is counted only for an explicit first-party GLP-1 offering with organization and city linkage; ambiguous, metadata-only, system-generic or weight-management-only evidence is disclosed but not counted.",
                "All ten pages remain held because each has fewer than six conservatively verified direct GLP-1 records.",
            ],
        }
    )
    raw = json.dumps(output, indent=2, sort_keys=True) + "\n"
    CITY_BATCH.write_text(raw)
    print(json.dumps({"status": "PASS", "cities": 10, "records": 100, "new_direct_glp": 2, "new_weight_only": 1, "sha256": hashlib.sha256(raw.encode()).hexdigest()}, sort_keys=True))


if __name__ == "__main__":
    main()
