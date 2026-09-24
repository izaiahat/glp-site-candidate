#!/usr/bin/env python3
"""Generate missing responsive guide artwork discovered by Round 2 browser QA."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import ImageOps

from process_ultracode_phase6_assets import generate_composition, save_clean

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ("guide-mounjaro-vs-ozempic-label-and-cost", "/guides/mounjaro-vs-ozempic-label-and-cost/", "COMPARE"),
    ("guide-cheapest-glp1", "/guides/cheapest-glp1/", "COST"),
    ("guide-zepbound-coupon", "/guides/zepbound-coupon/", "COUPON"),
    ("guide-how-to-get-zepbound-online", "/guides/how-to-get-zepbound-online/", "ACCESS"),
    ("guide-how-to-get-ozempic-online", "/guides/how-to-get-ozempic-online/", "ACCESS"),
)
DERIVATIVES = ROOT / "assets/derivatives"
PROVENANCE = ROOT / "artifacts/ultracode/round2-guide-artwork-provenance.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    target_records = []
    output_count = 0
    for stem, route, topic in TARGETS:
        native, params = generate_composition(stem, route, topic)
        outputs = []
        for width, height in ((800, 450), (1600, 900)):
            resized = native.resize((width, height))
            for suffix in (".avif", ".webp", ".jpg"):
                target = DERIVATIVES / f"{stem}-{width}{suffix}"
                save_clean(resized, target)
                outputs.append(target)

        og = ImageOps.fit(native, (1200, 630))
        og_target = DERIVATIVES / f"{stem}-og.jpg"
        save_clean(og, og_target)
        outputs.append(og_target)
        output_count += len(outputs)
        target_records.append({
            "route": route,
            "stem": stem,
            "params": params,
            "outputs": [
                {
                    "path": str(path.relative_to(ROOT)),
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
                for path in outputs
            ],
        })

    record = {
        "schema": "glp-ultracode-round2-guide-artwork-v2",
        "status": "PASS",
        "authority": "artifacts/ultracode/DESIGN-DIRECTION.md; ULTRACODE-DESIGN-GOAL-20260821.md §14",
        "generation": "deterministic local Pillow/NumPy aurora and data composition; no network or external generation service",
        "targets": target_records,
    }
    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    PROVENANCE.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "outputs": output_count, "provenance": str(PROVENANCE.relative_to(ROOT))}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
