#!/usr/bin/env python3
"""Build a large, honest national Clinic Scout directory from Census + NPPES.

This script never treats an NPI as proof of GLP-1 service. It stores only NPI-2
organization identity, city/state/postal prefix, taxonomy, and registry dates.
Exact first-party GLP evidence is preserved only from the accepted predecessor.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUSINESS = Path("/home/ubuntu/business")
CENSUS = BUSINESS / "reports/glp-clinic-scout/operator-national-wow-20260723/research/sub-est2025.csv"
OUT = ROOT / "data/directory/npi-city-batch.json"
CACHE = ROOT / "data/directory/national-cache"
API = "https://npiregistry.cms.hhs.gov/api/"
AS_OF = "2026-07-23"
CENSUS_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv"
TARGET_DEFAULT = 250
CANDIDATE_DEFAULT = 330
TAXONOMY_QUERIES = [
    "Obesity Medicine",
    "Endocrinology, Diabetes & Metabolism",
    "Family Medicine",
    "Internal Medicine",
]
STATE_ABBR = {
    "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
    "Connecticut":"CT","Delaware":"DE","District of Columbia":"DC","Florida":"FL","Georgia":"GA",
    "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
    "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
    "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
    "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
    "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
    "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
    "Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
    "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
}
NAME_OVERRIDES = {
    "Nashville-Davidson metropolitan government (balance)": "Nashville",
    "Louisville/Jefferson County metro government (balance)": "Louisville",
    "Lexington-Fayette urban county": "Lexington",
    "Indianapolis city (balance)": "Indianapolis",
    "Augusta-Richmond County consolidated government (balance)": "Augusta",
    "Athens-Clarke County unified government (balance)": "Athens",
    "Macon-Bibb County": "Macon",
    "Columbus city (balance)": "Columbus",
    "Urban Honolulu CDP": "Honolulu",
    "Anchorage municipality": "Anchorage",
}
SUFFIX_RE = re.compile(
    r"\s+(?:city|town|village|borough|municipality|CDP|consolidated government(?: \(balance\))?|"
    r"metropolitan government(?: \(balance\))?|urban county|unified government(?: \(balance\))?)$",
    re.I,
)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def normalize_city(name: str) -> str:
    if name in NAME_OVERRIDES:
        return NAME_OVERRIDES[name]
    value = SUFFIX_RE.sub("", name).strip()
    if "/" in value:
        value = value.split("/", 1)[0]
    return value


def census_candidates(maximum: int) -> list[dict]:
    if not CENSUS.is_file():
        raise RuntimeError(f"missing official Census source: {CENSUS}")
    rows = []
    with CENSUS.open(encoding="cp1252", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("SUMLEV") not in {"162", "170"}:
                continue
            state = STATE_ABBR.get(row.get("STNAME", ""))
            population = int(row.get("POPESTIMATE2025") or 0)
            if not state or population < 20_000:
                continue
            city = normalize_city(row["NAME"])
            slug = f"{slugify(city)}-{state.lower()}"
            rows.append({
                "city": city,
                "state": state,
                "slug": slug,
                "city_slug": slug,
                "census_geographic_area": row["NAME"],
                "census_state_name": row["STNAME"],
                "census_sumlev": row["SUMLEV"],
                "population_2025": population,
                "census_rank_basis": "2025 resident population estimate",
                "census_source_url": CENSUS_URL,
            })
    rows.sort(key=lambda item: (-item["population_2025"], item["state"], item["city"]))
    unique = []
    seen = set()
    for row in rows:
        if row["slug"] in seen:
            continue
        seen.add(row["slug"])
        unique.append(row)
        if len(unique) >= maximum:
            break
    return unique


def request_json(params: dict, attempts: int = 5) -> tuple[dict, str]:
    query = urllib.parse.urlencode(params)
    url = f"{API}?{query}"
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": "ClinicScout-National-Staging-Research/2.0"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read()), url
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt + 1 == attempts:
                raise
            time.sleep(min(8, 0.5 * (2 ** attempt)))
    raise AssertionError("unreachable")


def sanitize(result: dict, city: str, state: str, taxonomy_query: str) -> dict | None:
    basic = result.get("basic") or {}
    if result.get("enumeration_type") != "NPI-2" or basic.get("status") not in {None, "A"}:
        return None
    name = str(basic.get("organization_name") or "").strip()
    npi = str(result.get("number") or "")
    locations = [item for item in result.get("addresses", []) if item.get("address_purpose") == "LOCATION"]
    location = locations[0] if locations else {}
    if not name or not re.fullmatch(r"\d{10}", npi):
        return None
    if str(location.get("city") or "").casefold() != city.casefold() or str(location.get("state") or "").upper() != state:
        return None
    taxonomies = sorted({
        (str(item.get("code") or "").strip(), str(item.get("desc") or "").strip(), bool(item.get("primary")))
        for item in result.get("taxonomies", []) if item.get("code") and item.get("desc")
    })
    if not taxonomies:
        return None
    return {
        "city": city,
        "direct_service_source_url": None,
        "direct_service_verified_as_of": None,
        "enumeration_date": basic.get("enumeration_date"),
        "enumeration_type": "NPI-2",
        "evidence_class": "NPPES_REGISTRY_ONLY_NOT_SERVICE_EVIDENCE",
        "glp_service_verified": False,
        "last_updated": basic.get("last_updated"),
        "npi": npi,
        "nppes_api_url": f"https://npiregistry.cms.hhs.gov/api/?version=2.1&number={npi}",
        "nppes_checked_at_utc": f"{AS_OF}T20:45:00Z",
        "organization_name": name,
        "postal_prefix": str(location.get("postal_code") or "")[:5],
        "publication_status": "HELD_NATIONAL_DIRECTORY_RELEASE",
        "source_query_taxonomy": taxonomy_query,
        "state": state,
        "status": "A",
        "taxonomies": [{"code": code, "description": desc, "primary": primary} for code, desc, primary in taxonomies],
        "weight_management_service_verified": False,
    }


def primary_description(record: dict) -> str:
    primary = next((item for item in record["taxonomies"] if item.get("primary")), None)
    return (primary or record["taxonomies"][0]).get("description") or "Other"


def evidence_tier(direct_count: int) -> str:
    if direct_count >= 6:
        return "DIRECT_SERVICE_STRONG_6_PLUS"
    if direct_count >= 2:
        return "DIRECT_SERVICE_SAMPLE_2_TO_5"
    if direct_count == 1:
        return "DIRECT_SERVICE_SINGLE"
    return "REGISTRY_RESEARCH_ONLY"


def finish_city(meta: dict, records: list[dict], source_queries: list[dict], predecessor: dict | None = None) -> dict:
    if predecessor:
        records = predecessor["records"]
        source_queries = predecessor.get("source_queries", source_queries)
    unique = {record["npi"]: record for record in records}
    records = list(unique.values())[:15]
    mix = Counter(primary_description(record) for record in records)
    if len(records) < 10 or len(mix) < 2:
        raise ValueError(f"thin:{meta['slug']}:{len(records)}:{len(mix)}")
    direct = sum(record.get("glp_service_verified") is True for record in records)
    latest_updates = sorted({str(record.get("last_updated") or "") for record in records if record.get("last_updated")}, reverse=True)
    tier = evidence_tier(direct)
    city = meta["city"]
    state = meta["state"]
    local = (
        f"{city}, {state} is ranked within this 250-city national staging set using the U.S. Census Bureau's 2025 population estimate of "
        f"{meta['population_2025']:,} residents. This page contains {len(records)} active NPI-2 organization records across {len(mix)} primary taxonomy groups. "
        f"NPPES proves registry identity, taxonomy, and listed location only; it does not prove GLP-1 service, licensure, credentials, quality, availability, insurance participation, pricing, or outcomes. "
        f"Direct first-party GLP organization-city evidence is tracked separately ({direct} match{'es' if direct != 1 else ''}); users must verify every service through the organization's official channel."
    )
    return {
        **meta,
        "api_result_count": sum(int(item.get("api_result_count") or 0) for item in source_queries),
        "city_limitations": [
            "NPPES identifies organizations, taxonomy and listed locations; it does not prove licensure, credentials, quality, availability, insurance participation, pricing, outcomes or GLP-1 service.",
            "A direct service source can establish only the named organization-and-city service statement checked on that date; it does not prove that every location or clinician offers the service.",
            "Confirm current service, clinician availability, eligibility, pricing and coverage through the organization's official channel before relying on a listing.",
        ],
        "direct_glp_service_verified_count": direct,
        "direct_service_evidence_tier": tier,
        "direct_weight_management_only_count": sum(record.get("weight_management_service_verified") is True and not record.get("glp_service_verified") for record in records),
        "gate_reason": "registry_value_floor_passed_release_held",
        "latest_registry_update_dates": latest_updates[:3],
        "local_context": local,
        "local_value_summary": local,
        "minimum_direct_glp_services_for_sample_tier": 2,
        "minimum_direct_glp_services_for_strong_tier": 6,
        "minimum_records_required": 10,
        "page_status": "PASS_REGISTRY_DATA_HELD_FROM_RELEASE",
        "primary_taxonomy_mix": dict(sorted(mix.items())),
        "records": records,
        "sanitized_record_count": len(records),
        "selected_active_npi2_record_count": len(records),
        "source_checked_at": AS_OF,
        "source_name": "U.S. Census Bureau Vintage 2025 population estimates + NPPES NPI Registry API v2.1",
        "source_provenance_note": "Census supports city selection and population context. NPPES supports organization identity, NPI, taxonomy and listed location; neither proves GLP-1 service. Direct service is a separate first-party evidence tier.",
        "source_queries": source_queries,
        "source_url": "https://npiregistry.cms.hhs.gov/api-page",
        "value_floor": {
            "population_context_present": True,
            "active_npi2_records": len(records),
            "primary_taxonomy_groups": len(mix),
            "unique_npis": len({record["npi"] for record in records}),
            "verification_workflow_present": True,
            "claim_scope": "registry research; not a GLP service claim",
        },
    }


def fetch_city(meta: dict, predecessor: dict | None) -> dict:
    cache_path = CACHE / f"{meta['slug']}.json"
    if cache_path.is_file() and not predecessor:
        cached = json.loads(cache_path.read_text())
        return finish_city(meta, cached["records"], cached["source_queries"])
    if predecessor:
        return finish_city(meta, predecessor["records"], predecessor.get("source_queries", []), predecessor)
    groups = []
    source_queries = []
    for taxonomy in TAXONOMY_QUERIES:
        payload, url = request_json({
            "version": "2.1",
            "enumeration_type": "NPI-2",
            "taxonomy_description": taxonomy,
            "address_purpose": "LOCATION",
            "city": meta["city"],
            "state": meta["state"],
            "country_code": "US",
            "limit": 50,
            "skip": 0,
            "pretty": "off",
        })
        records = [record for raw in payload.get("results", []) if (record := sanitize(raw, meta["city"], meta["state"], taxonomy))]
        records.sort(key=lambda item: (item["organization_name"].casefold(), item["npi"]))
        groups.append(records)
        source_queries.append({
            "taxonomy_description": taxonomy,
            "source_url": url,
            "api_result_count": payload.get("result_count", len(records)),
            "sanitized_record_count": len(records),
        })
    selected = []
    seen = set()
    while len(selected) < 15 and any(groups):
        for group in groups:
            while group and group[0]["npi"] in seen:
                group.pop(0)
            if group and len(selected) < 15:
                record = group.pop(0)
                seen.add(record["npi"])
                selected.append(record)
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"records": selected, "source_queries": source_queries}, indent=2, sort_keys=True) + "\n")
    return finish_city(meta, selected, source_queries)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=TARGET_DEFAULT)
    parser.add_argument("--candidates", type=int, default=CANDIDATE_DEFAULT)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    predecessor_payload = json.loads(OUT.read_text())
    predecessor = {city["city_slug"]: city for city in predecessor_payload.get("cities", [])}
    candidates = census_candidates(max(args.candidates, args.target))
    results = []
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_city, meta, predecessor.get(meta["slug"])): meta for meta in candidates}
        for future in as_completed(futures):
            meta = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:  # per-city failures are recorded and skipped
                failures.append({"slug": meta["slug"], "error": f"{type(exc).__name__}:{str(exc)[:180]}"})
    results.sort(key=lambda item: (-item["population_2025"], item["state"], item["city"]))
    cities = results[: args.target]
    if len(cities) < args.target:
        raise RuntimeError(f"national_target_not_met:{len(cities)}:{args.target}:{failures[:10]}")
    all_npis = [record["npi"] for city in cities for record in city["records"]]
    direct_counts = Counter(city["direct_service_evidence_tier"] for city in cities)
    output = {
        "schema": "glp-national-directory-census-nppes-v1",
        "as_of": AS_OF,
        "generated_at_utc": f"{AS_OF}T21:00:00Z",
        "launch_authorized": False,
        "indexing_authorized": False,
        "records_are_glp_clinics": False,
        "street_address_included": False,
        "phone_included": False,
        "individual_people_included": False,
        "census_source_url": CENSUS_URL,
        "nppes_source_url": "https://npiregistry.cms.hhs.gov/api-page",
        "query_taxonomies": TAXONOMY_QUERIES,
        "threshold_policy": {
            "registry_page_value_floor": "10 active unique NPI-2 organizations, two primary taxonomy groups, official population context, explicit service-proof limitation and verification workflow",
            "direct_service_sample_tier": 2,
            "direct_service_strong_tier": 6,
            "calibration": "claim-scoped: national registry research pages do not claim GLP service; direct service remains separately proven by first-party organization-city evidence",
        },
        "batch_summary": {
            "cities_built": len(cities),
            "records_sanitized": len(all_npis),
            "unique_npi_city_pairs": len({(city["city_slug"], record["npi"]) for city in cities for record in city["records"]}),
            "cities_by_evidence_tier": dict(sorted(direct_counts.items())),
            "cities_at_registry_value_floor": len(cities),
            "cities_held_from_release": len(cities),
            "all_city_pages_noindex_link_dark": True,
            "candidate_failures": len(failures),
        },
        "failures": failures,
        "cities": cities,
    }
    raw = json.dumps(output, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(raw)
    print(json.dumps({
        "status": "PASS",
        "cities": len(cities),
        "records": len(all_npis),
        "evidence_tiers": dict(sorted(direct_counts.items())),
        "failures": len(failures),
        "sha256": hashlib.sha256(raw.encode()).hexdigest(),
        "output": str(args.output),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
