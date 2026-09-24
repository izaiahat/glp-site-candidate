#!/usr/bin/env python3
"""Generate and validate the shared premium editorial image system.

Every published guide receives one deterministic, route-specific crop and seven
responsive outputs. Six original GPT Image 2 masters provide the category art
direction; deterministic crop/grade parameters keep every route distinct. A
future article cannot pass the build until its matching family is generated.
No competitor assets, labels, logos, medicine claims, people, or burned-in copy.
"""
from __future__ import annotations

import argparse
import copy
import os
import tempfile
import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CONTENT_FILES = (
    ROOT / "data/blog/content-batch.json",
    ROOT / "data/blog/content-national-wow-additions.json",
)
DERIVATIVES = ROOT / "assets/derivatives"
PUBLIC = ROOT / "public/assets/images"
MANIFEST = ROOT / "artifacts/ultracode/article-image-manifest.json"
MASTER_DIR = ROOT / "assets/source/article-masters"
MASTER_PROVENANCE = MASTER_DIR / "provenance.json"
ROUTE_MASTER_DIR = ROOT / "assets/source/article-masters-pass2"
ROUTE_MASTER_STATE_RELATIVE = Path("artifacts/ultracode/article-route-master-state.json")
ROUTE_MASTER_STATE = ROOT / ROUTE_MASTER_STATE_RELATIVE
FORMATS: dict[str, dict[str, Any]] = {
    "avif": {"quality": 64},
    "webp": {"quality": 80, "method": 6},
    "jpg": {"quality": 84, "optimize": True, "progressive": True},
}
# The cross-device browser matrix holds every hero rendered at <=390 CSS px to a
# 120,000-byte transfer budget (tests/browser/cross-device.spec.mjs). At
# deviceScaleFactor >= 2 the hero srcset resolves to the -1600 rung, so that rung
# -- in the two formats a phone actually negotiates out of the <picture> -- is
# what has to fit. transferSize counts the response headers on top of the file on
# disk (measured: ~300 bytes), so the producer encodes to a margin BELOW the
# browser budget rather than to the budget itself. The -800 rung, the og card and
# the universal .jpg fallback are never the resource a DPR>=2 phone fetches for
# these surfaces and keep their family quality untouched.
MOBILE_HERO_TRANSFER_BUDGET = 120_000
HEADER_MARGIN = 2_000
RESPONSIVE_BYTE_BUDGETS: dict[str, dict[str, int]] = {
    "1600": {
        "avif": MOBILE_HERO_TRANSFER_BUDGET - HEADER_MARGIN,
        "webp": MOBILE_HERO_TRANSFER_BUDGET - HEADER_MARGIN,
    },
}
# A derivative over its budget is re-encoded down this ladder until it fits. The
# floors stop the ladder before quality collapses: a family that cannot reach its
# budget above the floor is a generation defect the producer refuses, never a
# silently ugly hero.
QUALITY_FLOORS: dict[str, int] = {"avif": 46, "webp": 62, "jpg": 70}
QUALITY_STEP = 3
PALETTE = (
    (20, 82, 68),     # emerald
    (56, 212, 148),   # mint
    (91, 197, 220),   # cyan
    (164, 145, 237),  # violet
    (240, 167, 89),   # amber
    (236, 102, 82),   # coral
)
CATEGORY_KEYWORDS = (
    ("coverage", ("insurance", "coverage", "prior-authorization", "medicare", "hsa", "fsa", "assistance", "savings")),
    ("price", ("cost", "price", "cheapest", "coupon", "fees", "self-pay")),
    ("compare", ("-vs-", "comparison", "alternatives")),
    ("pharmacy", ("pharmacy", "fulfillment", "counterfeit", "verification", "verify", "safety")),
    ("access", ("how-to-get", "online", "intake", "subscription", "availability")),
    ("evidence", ("evidence", "side-effects", "regulatory", "status", "label")),
)

# These families are governed by the earlier Phase-6 image contract. D42 must
# index and validate them, but must not silently replace their pinned bytes or
# provenance with the newer shared editorial treatment.
PHASE6_PINNED_STEMS = {
    "guide-mounjaro-coupon",
    "guide-wegovy-pills-oral-semaglutide-cost",
    "guide-zepbound-wegovy-cost-without-insurance",
}


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def load_articles() -> list[dict[str, Any]]:
    articles: dict[str, dict[str, Any]] = {}
    for source in CONTENT_FILES:
        payload = json.loads(source.read_text())
        for article in payload["articles"]:
            route = article["canonical_path"]
            if route in articles:
                raise RuntimeError(f"duplicate_article_route:{route}")
            articles[route] = article
    return [articles[route] for route in sorted(articles)]



def validate_release_record(record, route, master_path, image):
    provider = record.get("provider", "higgsfield")
    spec = record.get("release_pipeline_receipt") or {}
    relative = Path(spec.get("path", ""))
    expected = Path("artifacts/ultracode/article-release-image-receipts") / f"{stem_for(route)}.json"
    receipt_path = ROOT / relative
    if relative != expected or receipt_path.is_symlink() or not receipt_path.is_file() or sha_file(receipt_path) != spec.get("sha256"):
        raise RuntimeError(f"article_release_receipt_unbound:{route}")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("schema") != "glp-article-hero-image-v1" or receipt.get("route") != route or receipt.get("h1") != record.get("h1") or receipt.get("visual_key") != stem_for(route):
        raise RuntimeError(f"article_release_receipt_identity:{route}")
    if receipt.get("provider", "higgsfield") != provider:
        raise RuntimeError(f"article_release_receipt_provider:{route}")
    if provider == "stock":
        if receipt.get("status") != "FALLBACK" or not receipt.get("reason") or receipt.get("fallback_key") != "editorial-evidence-hero":
            raise RuntimeError(f"article_stock_fallback_receipt_invalid:{route}")
        if image.size != (1600, 900):
            raise RuntimeError(f"article_stock_master_dimensions:{route}")
        source = ROOT / "assets/derivatives/editorial-evidence-hero-1600.webp"
        if sha_file(source) != record.get("source_sha256") or sha_file(master_path) != sha_file(source):
            raise RuntimeError(f"article_stock_source_unbound:{route}")
    else:
        models = {"gpt_image_2_native": "gpt-image-2", "higgsfield": "gpt_image_2"}
        valid = (max(image.size) >= 1536 and 1.7 <= image.width / image.height <= 1.8) if provider == "gpt_image_2_native" else (image.width >= 3800 and image.height >= 2100)
        if provider not in models or not valid or receipt.get("status") != "GENERATED" or receipt.get("model") != models[provider]:
            raise RuntimeError(f"article_release_provider_dimensions:{route}")
        source = receipt.get("selected_candidate", {}).get("source", {})
        if source.get("sha256") != record.get("source_sha256") or (source.get("width"), source.get("height")) != image.size:
            raise RuntimeError(f"article_release_source_binding:{route}")
    if receipt.get("prompt_sha256") != record.get("prompt_sha256"):
        raise RuntimeError(f"article_release_prompt_binding:{route}")
    files = receipt.get("files", [])
    expected = {f"{stem_for(route)}{suffix}": size for suffix, size in {
        "-800.avif": (800,450), "-1600.avif": (1600,900), "-800.webp": (800,450),
        "-1600.webp": (1600,900), "-800.jpg": (800,450), "-1600.jpg": (1600,900), "-og.jpg": (1200,630)}.items()}
    if len(files) != 7 or {f.get("name") for f in files} != set(expected):
        raise RuntimeError(f"article_release_family_coverage:{route}")
    for output in files:
        name = output["name"]
        file = DERIVATIVES / name
        if sha_file(file) != output.get("sha256") or file.stat().st_size != output.get("bytes") or (output.get("width"), output.get("height")) != expected[name]:
            raise RuntimeError(f"article_release_family_binding:{route}")
        if provider == "stock" and sha_file(file) != sha_file(DERIVATIVES / name.replace(stem_for(route), "editorial-evidence-hero", 1)):
            raise RuntimeError(f"article_stock_family_binding:{route}")

def load_route_masters(articles: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return the complete PASS 2 route-master set, or an empty map while its resumable batch is incomplete."""
    if not ROUTE_MASTER_STATE.exists():
        return {}
    state = json.loads(ROUTE_MASTER_STATE.read_text())
    expected = {article["canonical_path"] for article in articles}
    records = state.get("records") or {}
    passed = {route: record for route, record in records.items() if record.get("status") == "PASS"}
    if set(passed) != expected:
        return {}
    verified: dict[str, dict[str, Any]] = {}
    for route, record in passed.items():
        recorded_path = Path(record["output_path"]).resolve()
        expected_name = f"{stem_for(route)}.webp"
        if recorded_path.name != expected_name:
            raise RuntimeError(f"article_route_master_identity_invalid:{route}")
        # The immutable generation receipt names the candidate where the master
        # was originally created. Successor candidates vendor those exact bytes
        # into their own route-master directory, so validate the local mirror
        # rather than requiring the historical absolute path to sit under ROOT.
        path = (ROUTE_MASTER_DIR / expected_name).resolve()
        if ROUTE_MASTER_DIR.resolve() not in path.parents or not path.exists():
            raise RuntimeError(f"article_route_master_path_invalid:{route}")
        if sha_file(path) != record.get("output_sha256"):
            raise RuntimeError(f"article_route_master_hash_mismatch:{route}")
        with Image.open(path) as image:
            image.load()
            provider = record.get("provider", "higgsfield")
            if record.get("generation_lane") == "article_release_pipeline":
                validate_release_record(record, route, path, image)
            elif provider != "higgsfield":
                raise RuntimeError(f"article_route_master_provider_invalid:{route}")
            if record.get("generation_lane") != "article_release_pipeline" and (image.width < 2400 or image.height < 1200):
                raise RuntimeError(f"article_route_master_dims_invalid:{route}:{image.width}x{image.height}")
        verified[route] = {**record, "path": str(path.relative_to(ROOT))}
    return verified


def stem_for(route: str) -> str:
    slug = route.strip("/").split("/")[-1]
    if not slug or not all(char.isalnum() or char == "-" for char in slug):
        raise RuntimeError(f"article_route_slug_invalid:{route}")
    return f"guide-{slug}"


def category_for(article: dict[str, Any]) -> str:
    # Route nouns are the strongest visual signal. Editorial intent fields often
    # mention insurance or evidence incidentally and previously collapsed most
    # thumbnails into the same shield motif. Prefer the canonical slug, then use
    # title/keyword copy only when the route has no useful art-direction noun.
    route = str(article.get("canonical_path", "")).lower()
    route_priority = (
        ("compare", ("-vs-", "comparison", "alternatives")),
        ("price", ("cost", "price", "cheapest", "coupon", "fees", "self-pay")),
        ("access", ("how-to-get", "online", "intake", "subscription", "availability")),
        ("pharmacy", ("pharmacy", "fulfillment", "counterfeit", "verification", "verify", "safety")),
        ("coverage", ("insurance", "coverage", "prior-authorization", "medicare", "hsa", "fsa", "assistance", "savings")),
        ("evidence", ("evidence", "side-effects", "regulatory", "status", "label")),
    )
    for category, keywords in route_priority:
        if any(keyword in route for keyword in keywords):
            return category
    haystack = " ".join(str(article.get(key, "")) for key in ("h1", "primary_keyword")).lower().replace(" ", "-")
    for category, keywords in route_priority:
        if any(keyword in haystack for keyword in keywords):
            return category
    return "wellness"


def fit(image: Image.Image, size: tuple[int, int], x_bias: float = 0.5, y_bias: float = 0.5) -> Image.Image:
    width, height = size
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = round((resized.width - width) * max(0.0, min(1.0, x_bias)))
    top = round((resized.height - height) * max(0.0, min(1.0, y_bias)))
    return resized.crop((left, top, left + width, top + height))


def blurred_field(size: tuple[int, int], center: tuple[int, int], radius: tuple[int, int], color: tuple[int, int, int], alpha: int) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = center
    rx, ry = radius
    draw.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(*color, alpha))
    return layer.filter(ImageFilter.GaussianBlur(max(42, min(rx, ry) // 2)))


def glass_panel(canvas: Image.Image, box: tuple[int, int, int, int], color: tuple[int, int, int], radius: int = 44) -> None:
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1 + 18, y1 + 28, x2 + 18, y2 + 28), radius=radius, fill=(1, 25, 20, 82))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(shadow)
    panel = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle(box, radius=radius, fill=(*color, 72), outline=(247, 250, 243, 116), width=3)
    pd.line((x1 + radius, y1 + 3, x2 - radius, y1 + 3), fill=(255, 255, 255, 132), width=3)
    canvas.alpha_composite(panel)


def draw_motif(canvas: Image.Image, category: str, rng: random.Random, colors: list[tuple[int, int, int]]) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")
    if category == "price":
        glass_panel(canvas, (260, 150, 1010, 720), colors[0])
        for index, width in enumerate((540, 430, 500, 330)):
            y = 255 + index * 90
            draw.rounded_rectangle((360, y, 360 + width, y + 24), radius=12, fill=(244, 247, 236, 145))
        for x, y, radius in ((1180, 250, 110), (1290, 410, 82), (1110, 560, 70)):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*colors[4], 178), outline=(255, 241, 205, 180), width=4)
    elif category == "coverage":
        glass_panel(canvas, (245, 170, 900, 705), colors[2])
        glass_panel(canvas, (710, 245, 1335, 745), colors[3])
        cx, cy = 800, 400
        shield = [(cx, cy - 135), (cx + 115, cy - 88), (cx + 88, cy + 80), (cx, cy + 155), (cx - 88, cy + 80), (cx - 115, cy - 88)]
        draw.polygon(shield, fill=(*colors[1], 190), outline=(245, 255, 249, 190))
        draw.line((cx - 43, cy + 4, cx - 8, cy + 40, cx + 58, cy - 48), fill=(255, 255, 255, 220), width=16, joint="curve")
    elif category == "compare":
        glass_panel(canvas, (190, 155, 735, 735), colors[2])
        glass_panel(canvas, (865, 155, 1410, 735), colors[3])
        draw.ellipse((560, 342, 1040, 822), fill=(*colors[1], 48), outline=(*colors[1], 130), width=5)
        draw.line((800, 260, 800, 650), fill=(248, 250, 239, 125), width=3)
    elif category == "pharmacy":
        glass_panel(canvas, (210, 210, 970, 720), colors[2])
        draw.rounded_rectangle((1010, 270, 1285, 665), radius=88, fill=(238, 250, 246, 100), outline=(255, 255, 255, 185), width=5)
        draw.rounded_rectangle((1060, 190, 1235, 310), radius=36, fill=(*colors[1], 150), outline=(255, 255, 255, 170), width=4)
        draw.ellipse((1090, 410, 1205, 525), fill=(*colors[4], 140), outline=(255, 248, 228, 200), width=4)
        for index, width in enumerate((500, 390, 450)):
            y = 330 + index * 100
            draw.rounded_rectangle((320, y, 320 + width, y + 24), radius=12, fill=(244, 248, 240, 145))
    elif category == "access":
        glass_panel(canvas, (515, 105, 1085, 790), colors[3], 70)
        draw.rounded_rectangle((585, 190, 1015, 650), radius=42, fill=(245, 248, 239, 72), outline=(255, 255, 255, 110), width=3)
        for index, color in enumerate((colors[1], colors[2], colors[4])):
            y = 250 + index * 110
            draw.rounded_rectangle((655, y, 945, y + 70), radius=28, fill=(*color, 145))
        draw.ellipse((760, 700, 840, 780), fill=(245, 248, 239, 155))
    elif category == "evidence":
        glass_panel(canvas, (190, 165, 1410, 735), colors[0])
        points = []
        for index in range(10):
            x = 300 + index * 110
            y = 560 - round(90 * math.sin(index * 0.7 + rng.random() * 0.25)) - index * 9
            points.append((x, y))
        draw.line(points, fill=(*colors[1], 230), width=12, joint="curve")
        for x, y in points:
            draw.ellipse((x - 16, y - 16, x + 16, y + 16), fill=(248, 251, 241, 220), outline=(*colors[2], 220), width=5)
        for index, width in enumerate((640, 470, 550)):
            y = 260 + index * 70
            draw.rounded_rectangle((315, y, 315 + width, y + 18), radius=9, fill=(247, 249, 241, 105))
    else:
        for index in range(5):
            radius = 210 - index * 32
            cx = 800 + rng.randint(-85, 85)
            cy = 450 + rng.randint(-55, 55)
            draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(*colors[index % len(colors)], 165), width=18)
        glass_panel(canvas, (245, 170, 650, 730), colors[1])
        glass_panel(canvas, (950, 140, 1375, 700), colors[3])


def load_master_provenance() -> dict[str, dict[str, Any]]:
    if not MASTER_PROVENANCE.exists():
        raise RuntimeError("article_master_provenance_missing")
    provenance = json.loads(MASTER_PROVENANCE.read_text())
    if provenance.get("status") != "PASS_VISUAL_QA":
        raise RuntimeError("article_master_visual_qa_not_passed")
    generator = provenance.get("generator", {})
    if generator.get("model") != "gpt-image-2-high" or generator.get("external_generation_calls") != 6:
        raise RuntimeError("article_master_generation_lineage_invalid")
    if generator.get("competitor_assets_used") != 0:
        raise RuntimeError("article_master_competitor_assets_invalid")
    masters = {item["category"]: item for item in provenance.get("masters", [])}
    if set(masters) != {"access", "compare", "coverage", "evidence", "pharmacy", "price"}:
        raise RuntimeError("article_master_category_coverage_invalid")
    for category, item in masters.items():
        path = ROOT / item["path"]
        if path != MASTER_DIR / f"{category}.png" or not path.exists():
            raise RuntimeError(f"article_master_missing:{category}")
        if sha_file(path) != item["sha256"]:
            raise RuntimeError(f"article_master_hash_mismatch:{category}")
        with Image.open(path) as image:
            if list(image.size) != [item["width"], item["height"]]:
                raise RuntimeError(f"article_master_dims_mismatch:{category}")
    return masters


def compose(
    article: dict[str, Any],
    masters: dict[str, dict[str, Any]],
    route_masters: dict[str, dict[str, Any]] | None = None,
) -> tuple[Image.Image, dict[str, Any]]:
    route = article["canonical_path"]
    seed_hex = hashlib.sha256(route.encode()).hexdigest()
    seed = int(seed_hex[:16], 16)
    route_master = (route_masters or {}).get(route)
    if route_master:
        master_path = ROOT / route_master["path"]
        with Image.open(master_path) as source:
            source.load()
            native = fit(source.convert("RGB"), (1600, 900))
        return native, {
            "seed": seed,
            "seed_sha256": seed_hex,
            "category": category_for(article),
            "generation_model": "gpt_image_2",
            "master_path": route_master["path"],
            "master_sha256": route_master["output_sha256"],
            "prompt_sha256": route_master["prompt_sha256"],
            "subject": route_master["subject"],
            "disposition": "generated_from_gpt_image_2_route_master",
        }
    category = category_for(article)
    if category not in masters:
        raise RuntimeError(f"article_master_category_missing:{route}:{category}")
    master = masters[category]
    master_path = ROOT / master["path"]
    x_bias = 0.2 + ((seed >> 8) % 61) / 100
    y_bias = 0.12 + ((seed >> 16) % 77) / 100
    accent_index = (seed >> 24) % len(PALETTE)
    overlay_alpha = 4 + ((seed >> 32) % 6)
    with Image.open(master_path) as source:
        source.load()
        native = fit(source.convert("RGB"), (1600, 900), x_bias=x_bias, y_bias=y_bias)
    overlay = Image.new("RGBA", native.size, (*PALETTE[accent_index], overlay_alpha))
    native_rgba = Image.alpha_composite(native.convert("RGBA"), overlay)
    glow_x = 220 + ((seed >> 40) % 1160)
    glow_y = 140 + ((seed >> 52) % 620)
    glow_radius = 220 + ((seed >> 60) % 180)
    glow = Image.new("RGBA", native.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (glow_x - glow_radius, glow_y - glow_radius, glow_x + glow_radius, glow_y + glow_radius),
        fill=(*PALETTE[(accent_index + 2) % len(PALETTE)], 12),
    )
    native = Image.alpha_composite(native_rgba, glow.filter(ImageFilter.GaussianBlur(150))).convert("RGB")
    return native, {
        "seed": seed,
        "seed_sha256": seed_hex,
        "category": category,
        "crop_x_bias": round(x_bias, 2),
        "crop_y_bias": round(y_bias, 2),
        "grade_accent_index": accent_index,
        "grade_overlay_alpha": overlay_alpha,
        "route_glow": {"x": glow_x, "y": glow_y, "radius": glow_radius},
        "generation_model": "gpt-image-2-high",
        "master_path": master["path"],
        "master_sha256": master["sha256"],
        "disposition": "generated_from_gpt_image_2_master",
    }

def budget_for(name: str) -> int | None:
    """The encoded-byte ceiling this derivative has to fit, or None if it has none."""
    path = Path(name)
    return RESPONSIVE_BYTE_BUDGETS.get(path.stem.rsplit("-", 1)[-1], {}).get(path.suffix[1:].lower())


def save_clean(image: Image.Image, path: Path) -> None:
    suffix = path.suffix[1:].lower()
    fmt = "JPEG" if suffix == "jpg" else suffix.upper()
    clean = Image.new("RGB", image.size)
    clean.paste(image.convert("RGB"))
    path.parent.mkdir(parents=True, exist_ok=True)
    options = dict(FORMATS[suffix])
    budget = budget_for(path.name)
    floor = QUALITY_FLOORS[suffix]
    while True:
        clean.save(path, format=fmt, **options)
        size = path.stat().st_size
        if budget is None or size <= budget:
            return
        if options["quality"] <= floor:
            raise RuntimeError(f"article_image_byte_budget_unreachable:{path.name}:{size}>{budget}@q{options['quality']}")
        options["quality"] = max(floor, options["quality"] - QUALITY_STEP)


def existing_family_outputs(stem: str) -> list[dict[str, Any]]:
    outputs = []
    for width, height, label in ((800, 450, "800"), (1600, 900, "1600")):
        for suffix in FORMATS:
            name = f"{stem}-{label}.{suffix}"
            derivative = DERIVATIVES / name
            public = PUBLIC / name
            if not derivative.exists() or not public.exists():
                raise RuntimeError(f"phase6_pinned_asset_missing:{name}")
            if sha_file(derivative) != sha_file(public):
                raise RuntimeError(f"phase6_pinned_asset_mirror_drift:{name}")
            outputs.append({"name": name, "width": width, "height": height, "sha256": sha_file(derivative), "bytes": derivative.stat().st_size})
    name = f"{stem}-og.jpg"
    derivative = DERIVATIVES / name
    public = PUBLIC / name
    if not derivative.exists() or not public.exists():
        raise RuntimeError(f"phase6_pinned_asset_missing:{name}")
    if sha_file(derivative) != sha_file(public):
        raise RuntimeError(f"phase6_pinned_asset_mirror_drift:{name}")
    outputs.append({"name": name, "width": 1200, "height": 630, "sha256": sha_file(derivative), "bytes": derivative.stat().st_size})
    return outputs


def image_inputs(article: dict[str, Any]) -> dict[str, Any]:
    """All content fields read by generate/compose/category_for, not article body.

    The route-master prompt in pass2-generate-route-images.py is route-derived
    (slug_title, scene_for, composition_for). No hero-brief field is consumed.
    h1 also binds record identity; primary_keyword is the category fallback.
    """
    if not isinstance(article.get("h1"), str) or not isinstance(article.get("canonical_path"), str):
        raise RuntimeError("article_image_inputs_invalid")
    return {"canonical_path": article["canonical_path"], "h1": article["h1"],
            "primary_keyword": article.get("primary_keyword", "")}


def input_hash(inputs: dict[str, Any]) -> str:
    return sha_bytes(json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())


def input_binding(original: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    diff = {key: {"before": original[key], "after": current[key]}
            for key in original if original[key] != current[key]}
    return {"image_inputs": original, "image_inputs_sha256": input_hash(original),
            "current_image_inputs": current, "current_image_inputs_sha256": input_hash(current),
            "inputs_stale": bool(diff), "image_input_diff": diff}


def bound_inputs(record: dict[str, Any], article: dict[str, Any]) -> dict[str, Any] | None:
    if "image_inputs" not in record:
        if any(key in record for key in ("inputs_stale", "current_image_inputs", "image_inputs_sha256")):
            raise RuntimeError(f"article_image_input_binding_incomplete:{record['route']}")
        return None
    original = record["image_inputs"]
    if set(original) != {"canonical_path", "h1", "primary_keyword"} or original["canonical_path"] != record["route"]:
        raise RuntimeError(f"article_image_input_identity_invalid:{record['route']}")
    expected = input_binding(original, image_inputs(article))
    if any(record.get(key) != value for key, value in expected.items()):
        raise RuntimeError(f"article_image_input_binding_stale:{record['route']}")
    return original


def rebind_sources(source_baseline: Path | None = None) -> dict[str, Any]:
    """Metadata only: retain all masters/derivatives and immutable generation facts."""
    before_bytes = MANIFEST.read_bytes()
    before_hash = sha_bytes(before_bytes)
    manifest = json.loads(before_bytes)
    proposed = copy.deepcopy(manifest)
    current = {a["canonical_path"]: a for a in load_articles()}
    records = proposed.get("records", [])
    if len({r["route"] for r in records}) != len(records) or {r["route"] for r in records} != set(current):
        raise RuntimeError("article_image_rebind_route_coverage_invalid")
    baseline_articles = {}
    if any("image_inputs" not in record for record in records):
        pins = manifest.get("source_files", [])
        expected_paths = [str(p.relative_to(ROOT)) for p in CONTENT_FILES]
        if [r.get("path") for r in pins] != expected_paths:
            raise RuntimeError("article_image_rebind_baseline_paths_invalid")
        for pin in pins:
            file = (source_baseline or ROOT) / pin["path"]
            if not file.is_file() or sha_file(file) != pin["sha256"]:
                raise RuntimeError(f"article_image_rebind_baseline_required:{pin['path']}")
            for article in json.loads(file.read_text())["articles"]:
                route = article["canonical_path"]
                if route in baseline_articles:
                    raise RuntimeError("article_image_rebind_baseline_duplicate")
                baseline_articles[route] = article
    for record in records:
        route = record["route"]
        if "image_inputs" in record:
            original = record["image_inputs"]
            if record.get("image_inputs_sha256") != input_hash(original):
                raise RuntimeError(f"article_image_rebind_original_input_hash:{route}")
        else:
            if route not in baseline_articles:
                raise RuntimeError(f"article_image_rebind_baseline_route_missing:{route}")
            original = image_inputs(baseline_articles[route])
        if record.get("title_sha256") != sha_bytes(original["h1"].encode()):
            raise RuntimeError(f"article_image_rebind_baseline_title_mismatch:{route}")
        record.update(input_binding(original, image_inputs(current[route])))
    proposed["source_files"] = [{"path": str(p.relative_to(ROOT)), "sha256": sha_file(p)} for p in CONTENT_FILES]
    # Validate every unchanged image hash/dimension/provenance before any write.
    validation = check(proposed)
    after_bytes = (json.dumps(proposed, indent=2, sort_keys=True) + "\n").encode()
    after_hash = sha_bytes(after_bytes)
    receipt = {"schema": "glp-article-image-source-rebind-v1", "status": "REBIND",
               "article_count": len(records), "before_manifest_sha256": before_hash,
               "after_manifest_sha256": after_hash, "before_source_files": manifest["source_files"],
               "after_source_files": proposed["source_files"],
               "rebound_routes": [r["route"] for r in records if not r["inputs_stale"]],
               "inputs_stale_routes": [r["route"] for r in records if r["inputs_stale"]],
               "records": [{"route": r["route"], "before_input_sha256": r["image_inputs_sha256"],
                            "after_input_sha256": r["current_image_inputs_sha256"],
                            "inputs_stale": r["inputs_stale"], "diff": r["image_input_diff"]} for r in records],
               "new_image_generation": 0, "generation_contract_unchanged": True, "validation": validation}
    receipt_path = MANIFEST.with_name(f"article-image-REBIND-{before_hash[:16]}-{after_hash[:16]}.json")
    receipt["receipt_path"] = str(receipt_path)
    # Content-addressed immutable preimage; receipt can be recovered after interruption.
    backup = MANIFEST.with_name(f"article-image-manifest-before-{before_hash}.json")
    if backup.exists():
        if backup.read_bytes() != before_bytes:
            raise RuntimeError("article_image_rebind_backup_collision")
    else:
        with backup.open("xb") as out:
            out.write(before_bytes)
    if MANIFEST.read_bytes() != before_bytes:
        raise RuntimeError("article_image_rebind_concurrent_manifest_change")
    if proposed["source_files"] != [{"path": str(p.relative_to(ROOT)), "sha256": sha_file(p)} for p in CONTENT_FILES]:
        raise RuntimeError("article_image_rebind_concurrent_source_change")
    if before_bytes != after_bytes:
        with tempfile.NamedTemporaryFile(dir=MANIFEST.parent, prefix=".rebind-", delete=False) as out:
            out.write(after_bytes)
            temporary = Path(out.name)
        os.replace(temporary, MANIFEST)
    receipt_bytes = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode()
    if receipt_path.exists():
        if receipt_path.read_bytes() != receipt_bytes:
            raise RuntimeError("article_image_rebind_receipt_collision")
    else:
        with receipt_path.open("xb") as out:
            out.write(receipt_bytes)
    if sha_file(MANIFEST) != after_hash:
        raise RuntimeError("article_image_rebind_readback_failed")
    return receipt


def generate(routes: list[str] | None = None, source_baseline: Path | None = None) -> dict[str, Any]:
    articles = load_articles()
    selected = set(routes) if routes else None
    previous = None
    if selected is not None:
        previous = json.loads(MANIFEST.read_text())
        inherited = {r['route']: r for r in previous['records']}
        current = {a['canonical_path']: a for a in articles}
        if not selected <= set(current) or set(inherited) != set(current):
            raise RuntimeError('article_image_selected_route_coverage_invalid')
        # Prove which complete article inputs changed before adopting corpus hashes.
        old = {}
        for pin in previous['source_files']:
            file = (source_baseline or ROOT) / pin['path']
            if sha_file(file) != pin['sha256']:
                raise RuntimeError(f"article_image_generation_baseline_required:{pin['path']}")
            old.update({a['canonical_path']: a for a in json.loads(file.read_text())['articles']})
        for route, article in current.items():
            if route not in selected and old.get(route) != article:
                raise RuntimeError(f'article_image_unselected_article_changed:{route}')
    masters = load_master_provenance()
    route_masters = load_route_masters(articles)
    records = []
    for article in articles:
        route = article["canonical_path"]
        if selected is not None and route not in selected:
            records.append(inherited[route])
            continue
        stem = stem_for(route)
        if not route_masters and stem in PHASE6_PINNED_STEMS:
            outputs = existing_family_outputs(stem)
            params = {"seed": None, "seed_sha256": None, "category": category_for(article), "disposition": "inherited_phase6_pinned"}
            art_direction = "inherited Phase-6 pinned original family; no burned-in text added by D42; provenance and bytes preserved"
        else:
            native, params = compose(article, masters, route_masters)
            outputs = []
            for width, height, label in ((800, 450, "800"), (1600, 900, "1600")):
                framed = fit(native, (width, height))
                for suffix in FORMATS:
                    name = f"{stem}-{label}.{suffix}"
                    derivative = DERIVATIVES / name
                    public = PUBLIC / name
                    save_clean(framed, derivative)
                    public.parent.mkdir(parents=True, exist_ok=True)
                    public.write_bytes(derivative.read_bytes())
                    outputs.append({"name": name, "width": width, "height": height, "sha256": sha_file(derivative), "bytes": derivative.stat().st_size})
            og = fit(native, (1200, 630))
            name = f"{stem}-og.jpg"
            derivative = DERIVATIVES / name
            public = PUBLIC / name
            save_clean(og, derivative)
            public.write_bytes(derivative.read_bytes())
            outputs.append({"name": name, "width": 1200, "height": 630, "sha256": sha_file(derivative), "bytes": derivative.stat().st_size})
            art_direction = (
                "premium route-specific GPT Image 2 editorial still life generated from the article subject; no burned-in text, logos, labels, product claims, testimonials, or competitor assets"
                if route_masters
                else "premium original clinical editorial still life from a visually approved GPT Image 2 category master; route-specific deterministic crop and subtle grade; no burned-in text, people, logos, labels, product claims, or competitor assets"
            )
        records.append({
            "route": route,
            "stem": stem,
            "title_sha256": sha_bytes(article["h1"].encode()),
            **input_binding(image_inputs(article), image_inputs(article)),
            "art_direction": art_direction,
            **params,
            "outputs": outputs,
        })
        print(json.dumps({"route": route, "stem": stem, "status": "PASS"}, sort_keys=True), flush=True)
    manifest = {
        "schema": "glp-article-image-system-v3" if route_masters else "glp-article-image-system-v2",
        "status": "PASS",
        "source_files": [{"path": str(path.relative_to(ROOT)), "sha256": sha_file(path)} for path in CONTENT_FILES],
        "article_count": len(records),
        "output_count": sum(len(record["outputs"]) for record in records),
        "future_article_gate": "python3 scripts/generate-article-imagery.py --check",
        "master_provenance": {"path": str(MASTER_PROVENANCE.relative_to(ROOT)), "sha256": sha_file(MASTER_PROVENANCE)},
        "master_count": len(masters),
        "route_master_count": len(route_masters),
        "route_master_state": {"path": str(ROUTE_MASTER_STATE_RELATIVE), "sha256": sha_file(ROUTE_MASTER_STATE)} if route_masters else None,
        "external_generation_services_used": len(route_masters) if route_masters else 6,
        "generation_model": "gpt_image_2" if route_masters else "gpt-image-2-high",
        "competitor_assets_used": 0,
        "records": records,
    }
    if previous is not None:
        # Preserve every unselected record and its generation contract verbatim.
        manifest = {**previous, 'source_files': manifest['source_files'], 'records': records,
                    'article_count': len(records), 'output_count': sum(len(r['outputs']) for r in records)}
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def check(manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    if manifest is None:
        if not MANIFEST.exists():
            raise RuntimeError("article_image_manifest_missing")
        manifest = json.loads(MANIFEST.read_text())
    masters = load_master_provenance()
    schema = manifest.get("schema")
    if schema not in {"glp-article-image-system-v2", "glp-article-image-system-v3"}:
        raise RuntimeError("article_image_manifest_schema_stale")
    if manifest.get("master_provenance") != {"path": str(MASTER_PROVENANCE.relative_to(ROOT)), "sha256": sha_file(MASTER_PROVENANCE)}:
        raise RuntimeError("article_master_provenance_lineage_stale")
    if manifest.get("master_count") != len(masters):
        raise RuntimeError("article_master_generation_count_stale")
    articles = load_articles()
    route_masters = load_route_masters(articles) if schema == "glp-article-image-system-v3" else {}
    if schema == "glp-article-image-system-v3":
        if len(route_masters) != len(articles):
            raise RuntimeError("article_route_master_set_incomplete")
        if manifest.get("route_master_count") != len(route_masters) or manifest.get("external_generation_services_used") != sum(r.get("provider") != "stock" for r in route_masters.values()):
            raise RuntimeError("article_route_master_generation_count_stale")
        if manifest.get("generation_model") != "gpt_image_2":
            raise RuntimeError("article_route_master_generation_model_stale")
        if manifest.get("route_master_state") != {"path": str(ROUTE_MASTER_STATE_RELATIVE), "sha256": sha_file(ROUTE_MASTER_STATE)}:
            raise RuntimeError("article_route_master_state_lineage_stale")
    elif manifest.get("external_generation_services_used") != 6 or manifest.get("generation_model") != "gpt-image-2-high":
        raise RuntimeError("article_master_generation_contract_stale")
    if manifest.get("competitor_assets_used") != 0:
        raise RuntimeError("article_master_generation_contract_stale")
    expected = {article["canonical_path"]: article for article in articles}
    records = {record["route"]: record for record in manifest.get("records", [])}
    if set(records) != set(expected):
        raise RuntimeError(f"article_image_route_coverage_invalid:missing={sorted(set(expected)-set(records))}:extra={sorted(set(records)-set(expected))}")
    if manifest.get("source_files") != [{"path": str(path.relative_to(ROOT)), "sha256": sha_file(path)} for path in CONTENT_FILES]:
        raise RuntimeError("article_image_source_lineage_stale")
    checked = 0
    warnings = []
    for route, article in expected.items():
        record = records[route]
        original = bound_inputs(record, article)
        if original and record["inputs_stale"]:
            warnings.append({"level": "WARN", "code": "article_image_inputs_stale", "route": route,
                             "diff": record["image_input_diff"]})
        identity = original or article
        if record["stem"] != stem_for(route) or record["title_sha256"] != sha_bytes(identity["h1"].encode()):
            raise RuntimeError(f"article_image_identity_stale:{route}")
        if len(record.get("outputs", [])) != 7:
            raise RuntimeError(f"article_image_family_incomplete:{route}")
        if schema == "glp-article-image-system-v3":
            master = route_masters[route]
            if record.get("disposition") != ("stock_fallback_receipted" if master.get("provider") == "stock" else "generated_from_gpt_image_2_route_master"):
                raise RuntimeError(f"article_image_route_master_disposition_stale:{route}")
            if record.get("generation_model") != ("stock" if master.get("provider") == "stock" else "gpt_image_2"):
                raise RuntimeError(f"article_image_route_master_generation_model_stale:{route}")
            if record.get("master_path") != master["path"] or record.get("master_sha256") != master["output_sha256"]:
                raise RuntimeError(f"article_image_route_master_lineage_stale:{route}")
            if record.get("prompt_sha256") != master["prompt_sha256"] or record.get("subject") != master["subject"]:
                raise RuntimeError(f"article_image_route_master_subject_stale:{route}")
        elif record["stem"] not in PHASE6_PINNED_STEMS:
            category = category_for(original or article)
            if record.get("disposition") != "generated_from_gpt_image_2_master":
                raise RuntimeError(f"article_image_master_disposition_stale:{route}")
            if record.get("generation_model") != "gpt-image-2-high":
                raise RuntimeError(f"article_image_generation_model_stale:{route}")
            if record.get("master_path") != masters[category]["path"] or record.get("master_sha256") != masters[category]["sha256"]:
                raise RuntimeError(f"article_image_master_lineage_stale:{route}")
        for output in record["outputs"]:
            budget = budget_for(output["name"])
            if budget is not None and output["bytes"] > budget:
                raise RuntimeError(f"article_image_byte_budget_exceeded:{output['name']}:{output['bytes']}>{budget}")
            for root in (DERIVATIVES, PUBLIC):
                path = root / output["name"]
                if not path.exists() or sha_file(path) != output["sha256"]:
                    raise RuntimeError(f"article_image_hash_mismatch:{path}")
                with Image.open(path) as image:
                    image.load()
                    if image.size != (output["width"], output["height"]):
                        raise RuntimeError(f"article_image_dims_mismatch:{path}")
                    if image.getexif():
                        raise RuntimeError(f"article_image_exif_present:{path}")
            checked += 1
    return {"status": "PASS", "article_count": len(expected), "output_families": checked, "public_source_mirrors": checked * 2,
            "warnings": warnings, "inputs_stale_routes": [row["route"] for row in warnings]}


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--rebind-sources", action="store_true")
    parser.add_argument("--route", action="append", help="Re-derive only this route; repeat for several routes")
    parser.add_argument("--source-baseline", type=Path, help="Hash-matching historical content root for first binding only")
    args = parser.parse_args()
    if args.route and (args.check or args.rebind_sources):
        parser.error("--route is only valid for generation")
    if args.source_baseline is not None and not (args.rebind_sources or args.route):
        parser.error("--source-baseline requires --rebind-sources or --route")
    result = rebind_sources(args.source_baseline) if args.rebind_sources else check() if args.check else generate(args.route, args.source_baseline)
    for warning in result.get("warnings", []):
        print("WARN " + json.dumps(warning, sort_keys=True))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
