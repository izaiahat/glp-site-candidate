#!/usr/bin/env python3
"""Fetch sanitized NPPES v2.1 organization seeds for additive Batch 3 cities."""
from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "directory" / "npi-seeds-batch3.json"
API = "https://npiregistry.cms.hhs.gov/api/"
AS_OF = "2026-07-23"
CITIES = [
    {"city_slug": "chicago-il", "city": "Chicago", "state": "IL"},
    {"city_slug": "new-york-ny", "city": "New York", "state": "NY"},
    {"city_slug": "miami-fl", "city": "Miami", "state": "FL"},
    {"city_slug": "atlanta-ga", "city": "Atlanta", "state": "GA"},
    {"city_slug": "boston-ma", "city": "Boston", "state": "MA"},
]
TAXONOMY_QUERIES = [
    "Obesity Medicine",
    "Endocrinology, Diabetes & Metabolism",
    "Family Medicine",
    "Internal Medicine",
]


def request_json(params: dict[str, str | int]) -> tuple[dict, str]:
    query = urllib.parse.urlencode(params)
    url = f"{API}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "ClinicScout-Staging-Research/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:  # noqa: S310 - fixed official HTTPS host
        body = response.read()
    return json.loads(body), url


def sanitize(result: dict) -> dict | None:
    basic = result.get("basic") or {}
    if result.get("enumeration_type") != "NPI-2" or basic.get("status") not in {None, "A"}:
        return None
    name = (basic.get("organization_name") or "").strip()
    npi = str(result.get("number") or "")
    if not name or not any(character.isalpha() for character in name) or len(npi) != 10 or not npi.isdigit():
        return None
    locations = [item for item in result.get("addresses", []) if item.get("address_purpose") == "LOCATION"]
    location = locations[0] if locations else {}
    taxonomies = sorted(
        {
            (str(item.get("code") or "").strip(), str(item.get("desc") or "").strip(), bool(item.get("primary")))
            for item in result.get("taxonomies", [])
            if item.get("code") and item.get("desc")
        }
    )
    return {
        "npi": npi,
        "enumeration_type": "NPI-2",
        "status": basic.get("status") or "A",
        "organization_name": name,
        "city": str(location.get("city") or "").title(),
        "state": str(location.get("state") or "").upper(),
        "postal_prefix": str(location.get("postal_code") or "")[:5],
        "enumeration_date": basic.get("enumeration_date"),
        "last_updated": basic.get("last_updated"),
        "taxonomies": [
            {"code": code, "description": description, "primary": primary}
            for code, description, primary in taxonomies
        ],
        "glp_service_verified": False,
        "weight_management_service_verified": False,
        "publication_status": "HELD_DIRECT_SERVICE_THRESHOLD",
    }


def main() -> None:
    groups = []
    for city in CITIES:
        query_groups: list[list[dict]] = []
        source_queries = []
        for taxonomy in TAXONOMY_QUERIES:
            payload, url = request_json(
                {
                    "version": "2.1",
                    "enumeration_type": "NPI-2",
                    "taxonomy_description": taxonomy,
                    "address_purpose": "LOCATION",
                    "city": city["city"],
                    "state": city["state"],
                    "country_code": "US",
                    "limit": 50,
                    "skip": 0,
                    "pretty": "off",
                }
            )
            records_for_query = [record for item in payload.get("results", []) if (record := sanitize(item))]
            records_for_query = [
                {**record, "source_query_taxonomy": taxonomy}
                for record in records_for_query
                if record["city"].casefold() == city["city"].casefold() and record["state"] == city["state"]
            ]
            records_for_query.sort(key=lambda item: (item["organization_name"].casefold(), item["npi"]))
            query_groups.append(records_for_query)
            source_queries.append(
                {
                    "taxonomy_description": taxonomy,
                    "source_url": url,
                    "api_result_count": payload.get("result_count", len(records_for_query)),
                    "sanitized_record_count": len(records_for_query),
                }
            )

        records = []
        seen: set[str] = set()
        while len(records) < 25 and any(query_groups):
            for group in query_groups:
                while group and group[0]["npi"] in seen:
                    group.pop(0)
                if group and len(records) < 25:
                    record = group.pop(0)
                    seen.add(record["npi"])
                    records.append(record)
        mix = Counter(
            taxonomy["description"]
            for record in records
            for taxonomy in record["taxonomies"]
            if taxonomy["primary"]
        )
        if len(records) < 10 or len(mix) < 2:
            raise RuntimeError(f"thin_nppes_seed:{city['city_slug']}:{len(records)}:{len(mix)}")
        groups.append(
            {
                **city,
                "source_queries": source_queries,
                "source_name": "NPPES NPI Registry API v2.1",
                "retrieved_as_of": AS_OF,
                "api_result_count": sum(item["api_result_count"] for item in source_queries),
                "sanitized_record_count": len(records),
                "primary_taxonomy_mix": dict(sorted(mix.items())),
                "records": records,
                "local_value_gate": "HELD_DIRECT_SERVICE_THRESHOLD",
            }
        )

    output = {
        "schema": "glp-type5-npi-seed-batch3-v1",
        "as_of": AS_OF,
        "source_authority": "official NPPES v2.1 read API",
        "query_taxonomies": TAXONOMY_QUERIES,
        "records_are_glp_clinics": False,
        "street_address_included": False,
        "phone_included": False,
        "individual_people_included": False,
        "endpoint_included": False,
        "launch_authorized": False,
        "cities": groups,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(output, indent=2, sort_keys=True) + "\n"
    OUT.write_text(raw)
    print(
        json.dumps(
            {
                "status": "PASS",
                "cities": len(groups),
                "records": sum(group["sanitized_record_count"] for group in groups),
                "sha256": hashlib.sha256(raw.encode()).hexdigest(),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
