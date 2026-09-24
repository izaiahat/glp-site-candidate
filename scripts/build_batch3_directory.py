#!/usr/bin/env python3
"""Append five truthful registry-only NPPES metros to isolated Batch 3 staging."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUSINESS = Path("/home/ubuntu/business")
CITY_BATCH = ROOT / "data" / "directory" / "npi-city-batch.json"
SEEDS = ROOT / "data" / "directory" / "npi-seeds-batch3.json"
FIRECRAWL = BUSINESS / "reports/glp-clinic-scout/phase2-batch3-20260723/research/firecrawl-net-new-evidence.json"
GENERATED_AT_UTC = "2026-07-23T10:07:57Z"
AS_OF = "2026-07-23"

LIMITATIONS = [
    "NPPES identifies organizations, taxonomy and listed locations; it does not prove licensure, credentials, quality, availability, insurance participation or GLP-1 service.",
    "City-level first-party weight-management or GLP-1 evidence is not attached to an NPI record unless the source establishes an exact organization-and-city match and the identity linkage is documented.",
    "Use the organization’s official scheduling channel to confirm current service, clinician availability, eligibility, pricing and coverage before relying on a registry listing.",
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
    item.update(
        {
            "nppes_api_url": f"https://npiregistry.cms.hhs.gov/api/?version=2.1&number={item['npi']}",
            "nppes_checked_at_utc": GENERATED_AT_UTC,
            "publication_status": "HELD_DIRECT_SERVICE_THRESHOLD",
            "direct_service_source_url": None,
            "direct_service_verified_as_of": None,
            "glp_service_verified": False,
            "weight_management_service_verified": False,
            "evidence_class": "NPPES_IDENTITY_TAXONOMY_LOCATION_ONLY",
            "service_evidence": None,
        }
    )
    return item


def local_context(seed: dict, city_evidence: dict) -> str:
    classification = city_evidence["classification"].replace("_", " ").lower()
    return (
        f"{seed['city']}’s held sample contains ten active organization records selected across official NPPES obesity medicine, endocrinology, family medicine and internal-medicine queries. "
        f"A bounded first-party search found {classification} from {city_evidence['organization']}, but that source does not display an exact NPI and is not attached to any record or counted toward the direct GLP-1 threshold. "
        "Every listed organization remains registry-only until exact organization, city and current service evidence is established."
    )


def main() -> None:
    existing = json.loads(CITY_BATCH.read_text())
    seeds = json.loads(SEEDS.read_text())
    research = json.loads(FIRECRAWL.read_text())
    evidence_by_slug = {item["slug"]: item for item in research["city_source_evidence"]}
    existing_slugs = {city["slug"] for city in existing["cities"]}
    existing_npis = {record["npi"] for city in existing["cities"] for record in city["records"]}
    new_cities = []

    for seed in seeds["cities"]:
        slug = seed["city_slug"]
        if slug in existing_slugs:
            raise RuntimeError(f"city_collision:{slug}")
        if slug not in evidence_by_slug:
            raise RuntimeError(f"missing_firecrawl_city_context:{slug}")
        records = [normalize_record(record) for record in seed["records"][:10]]
        npis = [record["npi"] for record in records]
        if len(records) != 10 or len(set(npis)) != 10 or set(npis) & existing_npis:
            raise RuntimeError(f"record_count_or_duplicate:{slug}")
        mix = primary_mix(records)
        if len(mix) < 2:
            raise RuntimeError(f"taxonomy_mix_thin:{slug}")
        context = local_context(seed, evidence_by_slug[slug])
        new_cities.append(
            {
                "api_result_count": seed["api_result_count"],
                "city": seed["city"],
                "state": seed["state"],
                "slug": slug,
                "city_slug": slug,
                "source_name": seed["source_name"],
                "source_url": "https://npiregistry.cms.hhs.gov/api-page",
                "source_queries": seed["source_queries"],
                "source_checked_at": GENERATED_AT_UTC,
                "source_provenance_note": "Official NPPES v2.1 query URLs establish organization identity, taxonomy and listed location only; they do not prove a GLP-1 offering. Separate city-level first-party context is disclosed but is not attached to any NPI record without exact identity linkage.",
                "sanitized_record_count": len(records),
                "selected_active_npi2_record_count": 10,
                "minimum_records_required": 10,
                "minimum_direct_glp_services_required": 6,
                "direct_glp_service_verified_count": 0,
                "direct_weight_management_only_count": 0,
                "page_status": "HELD_DIRECT_SERVICE_THRESHOLD",
                "gate_reason": "direct_glp_service_verification_minimum_not_met",
                "primary_taxonomy_mix": mix,
                "local_context": context,
                "local_value_summary": context,
                "city_level_service_context": evidence_by_slug[slug],
                "city_limitations": LIMITATIONS,
                "records": records,
            }
        )
        existing_npis.update(npis)

    output = dict(existing)
    output["cities"] = existing["cities"] + new_cities
    all_npis = [record["npi"] for city in output["cities"] for record in city["records"]]
    if len(output["cities"]) != 15 or len(all_npis) != 150 or len(set(all_npis)) != 150:
        raise RuntimeError("global_city_or_npi_count_invalid")
    output.update(
        {
            "schema": "glp-clinic-scout-phase2-batch3-npi-city-batch-v1",
            "generated_at_utc": GENERATED_AT_UTC,
            "selection_method": "Ten active unique NPI-2 organizations per city, selected round-robin across official NPPES obesity medicine, endocrinology, family medicine and internal-medicine queries. NPPES is never service proof. City-level first-party context is disclosed separately and does not count without exact NPI-linked organization/service evidence.",
            "global_data_limitations": [
                "NPI issuance does not ensure or validate licensure or credentials.",
                "NPPES taxonomy and address data do not prove GLP-1 prescribing or weight-management services.",
                "Direct-service verification counts only with an explicit first-party GLP-1 offering and exact organization/city/NPI linkage; system-generic, city-generic, metadata-only or weight-management-only evidence is not counted.",
                "All fifteen pages remain held because each has fewer than six conservatively verified direct GLP-1 records.",
            ],
        }
    )
    raw = json.dumps(output, indent=2, sort_keys=True) + "\n"
    CITY_BATCH.write_text(raw)
    print(
        json.dumps(
            {
                "status": "PASS",
                "cities": len(output["cities"]),
                "records": len(all_npis),
                "new_cities": len(new_cities),
                "new_direct_glp": 0,
                "sha256": hashlib.sha256(raw.encode()).hexdigest(),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
