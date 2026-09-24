#!/usr/bin/env python3
"""Synchronize the separate keyword ownership map from the frozen Batch 2 content batch."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "data/blog/content-batch.json"
KEYWORDS = ROOT / "data/blog/keyword-ownership-map.json"

content = json.loads(CONTENT.read_text())
keyword_map = json.loads(KEYWORDS.read_text())
existing = {(item["primary_keyword"].casefold(), item["url"]) for item in keyword_map["entries"]}
for article in content["articles"]:
    key = (article["primary_keyword"].casefold(), article["canonical_path"])
    if key not in existing:
        keyword_map["entries"].append(
            {
                "primary_keyword": article["primary_keyword"],
                "url": article["canonical_path"],
                "risk_tier": article["risk_tier"],
                "status": article["status"],
                "owner": article["article_id"],
            }
        )
        existing.add(key)
keyword_map["schema"] = "glp-clinic-scout-phase2-batch2-keyword-ownership-v2"
KEYWORDS.write_text(json.dumps(keyword_map, indent=2) + "\n")
print(json.dumps({"status": "PASS", "entries": len(keyword_map["entries"])}, sort_keys=True))
