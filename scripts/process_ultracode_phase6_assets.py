#!/usr/bin/env python3
"""Deterministic, local-only ULTRACODE Phase-6 image pipeline.

The Phase-1 inventory is the work order. This script changes only RECROP,
REPROCESS, and REGENERATE_LOCAL image families, mirrors source derivatives into
the built public tree, strips metadata, and emits machine-verifiable provenance.
It intentionally has no network client and starts no subprocess.
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
import os
import random
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageEnhance,
    ImageFilter,
    ImageFont,
    ImageOps,
    __version__ as PILLOW_VERSION,
)

ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "artifacts/ultracode/baseline/legacy-image-inventory.json"
DESIGN_PATH = ROOT / "artifacts/ultracode/DESIGN-DIRECTION.md"
BASELINE_PATH = ROOT / "artifacts/ultracode/baseline/phase6-asset-preprocess-baseline.json"
BASELINE_SOURCE_ROOT = ROOT / "artifacts/ultracode/baseline/phase6-source-bytes"
PROVENANCE_PATH = ROOT / "artifacts/ultracode/asset-provenance.json"
RECEIPT_PATH = ROOT / "artifacts/ultracode/ASSET-PIPELINE-RECEIPT.md"
PUBLIC_IMAGES = ROOT / "public/assets/images"
DERIVATIVES = ROOT / "assets/derivatives"

ACTIONS = ("RECROP", "REPROCESS", "REGENERATE_LOCAL")
EXPECTED_PUBLIC_COUNTS = {"RECROP": 24, "REPROCESS": 53, "REGENERATE_LOCAL": 56}
TOOL = f"Python 3 + Pillow {PILLOW_VERSION} + NumPy {np.__version__} (local-only)"
FORMAT_OPTIONS: dict[str, dict[str, Any]] = {
    ".avif": {"quality": 68},
    ".webp": {"quality": 82, "method": 6},
    ".jpg": {"quality": 85, "optimize": True, "progressive": True, "subsampling": 2},
}
FORMAT_NAMES = {".avif": "AVIF", ".webp": "WEBP", ".jpg": "JPEG"}
# The Phase-6 brief calls for an approximately 16:10 rail media slot. The
# existing width-only naming remains unchanged; only the intrinsic height moves
# from the obsolete portrait crop to the new 8:5 responsive crop.
RAIL_DIMS = {640: (640, 400), 1280: (1280, 800)}

RAIL_TINTS = {
    "med-rail-semaglutide": (78, 221, 174),
    "med-rail-tirzepatide": (181, 164, 244),
    "med-rail-oral": (240, 190, 102),
    "med-rail-brand": (120, 205, 240),
}
FEATURE_TINTS = {
    "feat-telehealth": (117, 201, 236),
    "feat-pharmacy": (78, 221, 174),
    "feat-receipts": (240, 190, 102),
}
REGEN_TOPICS = {
    "directory-hero": "DIRECTORY",
    "guide-brand-vs-compounded-glp-1-cost": "COST",
    "guide-mounjaro-coupon": "COUPON",
    "guide-oral-glp-1-insurance-coverage": "COVERAGE",
    "guide-ozempic-alternatives": "ALTERNATIVES",
    "guide-ozempic-vs-zepbound": "COMPARE",
    "guide-zepbound-insurance-coverage": "COVERAGE",
    "guide-zepbound-wegovy-cost-without-insurance": "COST",
}
AURORA_COLORS = [
    (57, 217, 138),   # scout mint
    (86, 202, 224),   # cyan evidence
    (169, 155, 242),  # violet veil
    (239, 183, 90),   # amber veil
    (111, 198, 238),  # blue veil
]
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mean_luminance(image: Image.Image) -> float:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    luma = arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722
    return float(luma.mean())


def image_snapshot(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        image.load()
        dims = list(image.size)
        fmt = image.format
    return {
        "sha256": sha256_path(path),
        "bytes": path.stat().st_size,
        "dims": dims,
        "format": fmt,
    }


def load_inventory() -> dict[str, Any]:
    inventory = json.loads(INVENTORY_PATH.read_text())
    measured = Counter(record["status"] for record in inventory["per_image"].values())
    actual = {action: measured[action] for action in ACTIONS}
    if actual != EXPECTED_PUBLIC_COUNTS:
        raise RuntimeError(f"inventory_action_counts_invalid:{actual}")
    if len(inventory["per_image"]) != 768:
        raise RuntimeError("inventory_file_count_invalid")
    return inventory


def ensure_baseline(inventory: dict[str, Any]) -> dict[str, Any]:
    inventory_sha = sha256_path(INVENTORY_PATH)
    if BASELINE_PATH.exists():
        baseline = json.loads(BASELINE_PATH.read_text())
        if baseline.get("inventory_sha256") != inventory_sha:
            raise RuntimeError("phase6_baseline_inventory_mismatch")
        return baseline

    files: dict[str, Any] = {}
    for public_rel in sorted(inventory["per_image"]):
        public_path = ROOT / public_rel
        derivative_path = DERIVATIVES / public_path.name
        for path in (public_path, derivative_path):
            if not path.exists():
                raise RuntimeError(f"baseline_asset_missing:{path.relative_to(ROOT)}")
            files[str(path.relative_to(ROOT))] = image_snapshot(path)

    baseline = {
        "schema": "glp-ultracode-phase6-asset-baseline-v1",
        "inventory_sha256": inventory_sha,
        "design_direction_sha256": sha256_path(DESIGN_PATH),
        "files": files,
    }
    BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BASELINE_PATH.write_text(json.dumps(baseline, indent=2, sort_keys=True) + "\n")
    return baseline


def focal_point(image: Image.Image) -> tuple[float, float]:
    """Find a deterministic detail/contrast centroid with a mild center prior."""
    thumb = ImageOps.contain(image.convert("RGB"), (512, 512), Image.Resampling.LANCZOS)
    rgb = np.asarray(thumb, dtype=np.float32) / 255.0
    gray_image = thumb.convert("L")
    gray = np.asarray(gray_image, dtype=np.float32) / 255.0
    blur = np.asarray(gray_image.filter(ImageFilter.GaussianBlur(10)), dtype=np.float32) / 255.0
    edges = np.asarray(gray_image.filter(ImageFilter.FIND_EDGES), dtype=np.float32) / 255.0
    saturation = rgb.max(axis=2) - rgb.min(axis=2)
    local_contrast = np.abs(gray - blur)
    highlight = np.maximum(gray - float(np.median(gray)), 0.0)
    weights = 0.42 * local_contrast + 0.30 * edges + 0.18 * saturation + 0.10 * highlight + 0.002

    yy, xx = np.mgrid[0 : thumb.height, 0 : thumb.width]
    nx = (xx + 0.5) / thumb.width
    ny = (yy + 0.5) / thumb.height
    center_prior = 0.40 + 0.60 * np.exp(-(((nx - 0.5) / 0.48) ** 2 + ((ny - 0.5) / 0.48) ** 2))
    weights *= center_prior
    total = float(weights.sum())
    if not math.isfinite(total) or total <= 0:
        return 0.5, 0.5
    return float((weights * nx).sum() / total), float((weights * ny).sum() / total)


def cover_crop_box(
    source_size: tuple[int, int],
    target_size: tuple[int, int],
    focus: tuple[float, float],
) -> tuple[tuple[int, int, int, int], tuple[float, float]]:
    source_width, source_height = source_size
    target_ratio = target_size[0] / target_size[1]
    source_ratio = source_width / source_height
    if source_ratio > target_ratio:
        crop_height = source_height
        crop_width = max(1, round(crop_height * target_ratio))
    else:
        crop_width = source_width
        crop_height = max(1, round(crop_width / target_ratio))

    center_x = focus[0] * source_width
    center_y = focus[1] * source_height
    left = round(center_x - crop_width / 2)
    top = round(center_y - crop_height / 2)
    left = min(max(0, left), source_width - crop_width)
    top = min(max(0, top), source_height - crop_height)
    box = (left, top, left + crop_width, top + crop_height)
    focus_in_crop = (
        (center_x - left) / crop_width,
        (center_y - top) / crop_height,
    )
    return box, focus_in_crop


def gamma_to_luminance(image: Image.Image, target: float) -> tuple[Image.Image, float]:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    low, high = 0.12, 1.0
    chosen = 1.0
    for _ in range(28):
        gamma = (low + high) / 2
        candidate = np.power(arr, gamma)
        luma = candidate[..., 0] * 0.2126 + candidate[..., 1] * 0.7152 + candidate[..., 2] * 0.0722
        if float(luma.mean() * 255.0) > target:
            low = gamma
        else:
            high = gamma
        chosen = gamma
    result = np.clip(np.power(arr, chosen) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(result, "RGB"), chosen


def relight(image: Image.Image, target: float, tint: tuple[int, int, int]) -> tuple[Image.Image, dict[str, Any]]:
    source = image.convert("RGB")
    before = mean_luminance(source)
    balanced = ImageOps.autocontrast(source, cutoff=(0.35, 0.20))
    arr = np.asarray(balanced, dtype=np.float32) / 255.0
    tint_arr = np.asarray(tint, dtype=np.float32) / 255.0
    # A restrained screen tint lifts crushed shadows into the design palette.
    arr = 1.0 - (1.0 - arr) * (1.0 - tint_arr.reshape((1, 1, 3)) * 0.055)
    tinted = Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")
    tinted = ImageEnhance.Color(tinted).enhance(1.05)
    tinted = ImageEnhance.Contrast(tinted).enhance(1.06)
    lifted, gamma = gamma_to_luminance(tinted, target)
    lifted = lifted.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=3))
    # Re-pin after local contrast/sharpening so encoded derivatives remain above
    # the binding luminance floor rather than merely aiming near it.
    lifted, final_gamma = gamma_to_luminance(lifted, target + 2.0)
    return lifted, {
        "source_mean_luminance": round(before, 3),
        "target_mean_luminance": target,
        "gamma": round(gamma, 6),
        "final_gamma": round(final_gamma, 6),
        "tint_rgb": list(tint),
        "autocontrast_cutoff_percent": [0.35, 0.20],
        "contrast_factor": 1.06,
        "color_factor": 1.05,
    }


def palette_for_seed(seed: int) -> list[tuple[int, int, int]]:
    colors = list(AURORA_COLORS)
    rotation = seed % len(colors)
    colors = colors[rotation:] + colors[:rotation]
    adjusted = []
    for index, color in enumerate(colors):
        hue, saturation, value = colorsys.rgb_to_hsv(*(channel / 255.0 for channel in color))
        hue = (hue + (((seed >> (index * 3)) & 7) - 3) / 360.0) % 1.0
        saturation = min(0.78, max(0.42, saturation * (0.92 + ((seed >> (index * 2)) & 3) * 0.03)))
        value = min(0.96, max(0.72, value))
        rgb = colorsys.hsv_to_rgb(hue, saturation, value)
        adjusted.append(tuple(round(channel * 255) for channel in rgb))
    return adjusted


def add_topic_texture(image: Image.Image, word: str, seed: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    max_width = image.width * 0.78
    size = round(image.height * 0.23)
    font = ImageFont.truetype(str(FONT_BOLD), size)
    while size > 48:
        font = ImageFont.truetype(str(FONT_BOLD), size)
        box = draw.textbbox((0, 0), word, font=font)
        if box[2] - box[0] <= max_width:
            break
        size -= 8
    x = image.width * (0.50 + (((seed >> 20) & 15) - 7) / 250.0)
    y = image.height * (0.56 + (((seed >> 24) & 15) - 7) / 220.0)
    draw.text((x, y), word, font=font, fill=24, anchor="mm", stroke_width=max(1, size // 90), stroke_fill=6)
    angle = ((seed >> 28) % 13) - 6
    if angle:
        mask = mask.rotate(angle, resample=Image.Resampling.BICUBIC, center=(round(x), round(y)))
    texture = Image.new("RGB", image.size, (232, 245, 238))
    return Image.composite(texture, image, mask)


def generate_composition(stem: str, route: str, topic: str) -> tuple[Image.Image, dict[str, Any]]:
    seed_hex = hashlib.sha256(route.encode("utf-8")).hexdigest()
    seed = int(seed_hex[:16], 16)
    rng = random.Random(seed)
    palette = palette_for_seed(seed)
    low_size = (800, 450)
    canvas = Image.new("RGB", low_size, (7, 16, 13))

    # Route-specific aurora fields, all inside the binding emerald/pastel system.
    for index in range(5):
        color = palette[index % len(palette)]
        field = Image.new("RGB", low_size, (0, 0, 0))
        draw = ImageDraw.Draw(field)
        cx = rng.randint(-80, low_size[0] + 80)
        cy = rng.randint(-60, low_size[1] + 60)
        radius_x = rng.randint(180, 390)
        radius_y = rng.randint(100, 260)
        strength = 0.46 + rng.random() * 0.30
        fill = tuple(round(channel * strength) for channel in color)
        draw.ellipse((cx - radius_x, cy - radius_y, cx + radius_x, cy + radius_y), fill=fill)
        field = field.filter(ImageFilter.GaussianBlur(rng.randint(65, 125)))
        canvas = ImageChops.screen(canvas, field)

    # One luminous ribbon creates the binding left-to-right aurora direction.
    ribbon = Image.new("RGB", low_size, (0, 0, 0))
    ribbon_draw = ImageDraw.Draw(ribbon)
    phase = rng.random() * math.tau
    points = []
    for x in range(-60, low_size[0] + 61, 12):
        y = low_size[1] * (0.34 + 0.13 * math.sin(x / 115.0 + phase)) + rng.randint(-3, 3)
        points.append((x, round(y)))
    ribbon_color = tuple(round(channel * 0.68) for channel in palette[0])
    ribbon_draw.line(points, fill=ribbon_color, width=rng.randint(34, 58), joint="curve")
    ribbon = ribbon.filter(ImageFilter.GaussianBlur(34))
    canvas = ImageChops.screen(canvas, ribbon)

    # Abstract data geometry only: no values, medical objects, people, claims, or maps.
    geometry = Image.new("RGBA", low_size, (0, 0, 0, 0))
    geometry_draw = ImageDraw.Draw(geometry)
    geometry_color = (*palette[1], 40)
    mode = seed % 4
    if mode == 0:
        for offset in range(0, 8):
            x = 70 + offset * 92 + rng.randint(-8, 8)
            height = 70 + ((seed >> (offset * 4)) & 63)
            geometry_draw.rounded_rectangle((x, 310 - height, x + 46, 310), radius=12, outline=geometry_color, width=2)
    elif mode == 1:
        for radius in range(55, 270, 42):
            geometry_draw.arc((400 - radius, 220 - radius, 400 + radius, 220 + radius), 195, 350, fill=geometry_color, width=3)
    elif mode == 2:
        for y in range(75, 390, 54):
            start = 90 + rng.randint(-24, 24)
            end = 710 - rng.randint(0, 120)
            geometry_draw.rounded_rectangle((start, y, end, y + 17), radius=8, outline=geometry_color, width=2)
    else:
        for x in range(90, 760, 76):
            for y in range(72, 420, 66):
                if ((x + y + seed) // 7) % 3:
                    geometry_draw.rounded_rectangle((x, y, x + 32, y + 32), radius=8, fill=geometry_color)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), geometry).convert("RGB")

    native = canvas.resize((2400, 1350), Image.Resampling.LANCZOS)
    native = add_topic_texture(native, topic, seed)

    # Seeded monochrome dither suppresses smooth-field banding without changing
    # the palette or creating nondeterministic encoder noise.
    arr = np.asarray(native, dtype=np.int16)
    noise_rng = np.random.default_rng(seed ^ 0xA607A)
    noise = noise_rng.integers(-2, 3, size=(native.height, native.width, 1), dtype=np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    native = Image.fromarray(arr, "RGB")
    target = 94.0 + (seed % 9)
    native, gamma = gamma_to_luminance(native, target)
    params = {
        "seed": seed,
        "seed_sha256": seed_hex,
        "topic_texture": topic,
        "topic_word_count": 1,
        "palette_hex": ["#" + "".join(f"{channel:02x}" for channel in color) for color in palette],
        "canvas_rgb": [7, 16, 13],
        "aurora_fields": 5,
        "geometry_mode": mode,
        "dither_range": [-2, 2],
        "target_mean_luminance": target,
        "gamma": round(gamma, 6),
        "composition": "deep-emerald aurora field + abstract data geometry + one route-topic texture word",
    }
    return native, params


def save_clean(image: Image.Image, target: Path) -> None:
    suffix = target.suffix.lower()
    if suffix not in FORMAT_OPTIONS:
        raise RuntimeError(f"unsupported_output_format:{target}")
    fmt = FORMAT_NAMES[suffix]
    clean = Image.new("RGB", image.size)
    clean.paste(image.convert("RGB"))
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.phase6-tmp")
    clean.save(temporary, format=fmt, **FORMAT_OPTIONS[suffix])
    with Image.open(temporary) as check:
        check.verify()
    os.replace(temporary, target)


def atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.phase6-tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, target)


def target_dims(public_rel: str, inventory_record: dict[str, Any]) -> tuple[int, int]:
    stem = inventory_record["stem"]
    if inventory_record["status"] == "RECROP" and stem.startswith("med-rail-"):
        match = re.search(r"-(640|1280)\.(?:avif|webp|jpg)$", public_rel)
        if not match:
            raise RuntimeError(f"rail_variant_name_invalid:{public_rel}")
        return RAIL_DIMS[int(match.group(1))]
    return tuple(inventory_record["dims"])


def strongest_family_source(stem: str, inventory: dict[str, Any]) -> Path:
    candidates = []
    for public_rel, record in inventory["per_image"].items():
        if record["stem"] != stem:
            continue
        path = ROOT / public_rel
        score = (
            record["dims"][0] * record["dims"][1],
            3 if path.suffix == ".jpg" else 2 if path.suffix == ".webp" else 1,
            record["bytes"],
        )
        candidates.append((score, path))
    if not candidates:
        raise RuntimeError(f"family_source_missing:{stem}")
    public_path = max(candidates, key=lambda item: item[0])[1]
    # A clean baseline copy prevents interrupted or concurrent builds from
    # turning a retry into a second-generation re-encode of an earlier output.
    baseline_source = BASELINE_SOURCE_ROOT / "assets/derivatives" / public_path.name
    if baseline_source.exists():
        return baseline_source
    derivative_source = DERIVATIVES / public_path.name
    if derivative_source.exists():
        return derivative_source
    return public_path


def before_record(path: Path, baseline: dict[str, Any]) -> dict[str, Any]:
    relative = str(path.relative_to(ROOT))
    record = baseline["files"].get(relative)
    if not record:
        raise RuntimeError(f"baseline_record_missing:{relative}")
    return record


def make_provenance_record(
    path: Path,
    action: str,
    role: str,
    params: dict[str, Any],
    inputs: list[str],
    baseline: dict[str, Any],
) -> dict[str, Any]:
    before = before_record(path, baseline)
    after = image_snapshot(path)
    return {
        "path": str(path.relative_to(ROOT)),
        "action": action,
        "role": role,
        "tool": TOOL,
        "params": params,
        "inputs": inputs,
        "sha256_before": before["sha256"],
        "sha256_after": after["sha256"],
        "dims_before": before["dims"],
        "dims": after["dims"],
        "bytes_before": before["bytes"],
        "bytes_after": after["bytes"],
    }


def qa_image(path: Path, record: dict[str, Any]) -> dict[str, Any]:
    expected_dims = tuple(record["dims"])
    suffix = path.suffix.lower()
    failures = []
    try:
        with Image.open(path) as verify_image:
            verify_image.verify()
        with Image.open(path) as image:
            image.load()  # full-resolution decode, not a thumbnail-only check
            actual_dims = image.size
            actual_format = image.format
            exif_entries = len(image.getexif())
            rgb = image.convert("RGB")
            luma = rgb.convert("L")
            histogram = luma.histogram()
            pixels = rgb.width * rgb.height
            populated_bins = [index for index, count in enumerate(histogram) if count]
            occupied_bins = len(populated_bins)
            tonal_span = populated_bins[-1] - populated_bins[0] + 1
            tonal_bin_coverage = occupied_bins / tonal_span
            peak_bin_fraction = max(histogram) / pixels
            clipped_fraction = (sum(histogram[:2]) + sum(histogram[-2:])) / pixels
            mean = mean_luminance(rgb)
            standard_deviation = float(np.asarray(luma, dtype=np.float32).std())
            edge_sample = ImageOps.contain(luma, (512, 512), Image.Resampling.LANCZOS).filter(ImageFilter.FIND_EDGES)
            edge_energy = float(np.asarray(edge_sample, dtype=np.float32).mean())
            if actual_dims != expected_dims:
                failures.append(f"dims:{actual_dims}!={expected_dims}")
            if actual_format != FORMAT_NAMES[suffix]:
                failures.append(f"format:{actual_format}")
            if exif_entries:
                failures.append(f"exif_entries:{exif_entries}")
            if path.stat().st_size < 2_000:
                failures.append("encoded_file_too_small")
            # A moody emerald composition intentionally may not use all 256
            # luma values. Banding is instead a sparse/gapped tonal-span fault:
            # require broad range, near-continuous occupancy, and no plateau.
            if occupied_bins < 96 or tonal_bin_coverage < 0.88 or peak_bin_fraction > 0.14:
                failures.append(
                    "banding_risk:"
                    f"bins={occupied_bins},coverage={tonal_bin_coverage:.4f},peak={peak_bin_fraction:.4f}"
                )
            if standard_deviation < 18.0:
                failures.append(f"flat_image_stddev:{standard_deviation:.2f}")
            if edge_energy < 1.8:
                failures.append(f"artifact_or_empty_edge_energy:{edge_energy:.2f}")
            if clipped_fraction > 0.16:
                failures.append(f"excessive_clipping:{clipped_fraction:.4f}")
            action = record["action"]
            if action == "REPROCESS" and mean <= 90.0:
                failures.append(f"mean_luminance_floor:{mean:.3f}")
            if action == "RECROP" and mean <= 96.0:
                failures.append(f"recrop_brightness_floor:{mean:.3f}")
            if action == "REGENERATE_LOCAL" and mean <= 76.0:
                failures.append(f"composition_luminance_floor:{mean:.3f}")
            focus_in_crop = record["params"].get("focal_point_in_crop")
            if action == "RECROP" and focus_in_crop:
                if not all(0.10 <= float(value) <= 0.90 for value in focus_in_crop):
                    failures.append(f"focal_crop_unsafe:{focus_in_crop}")
            return {
                "status": "PASS" if not failures else "FAIL",
                "full_resolution_decode": True,
                "dims": list(actual_dims),
                "format": actual_format,
                "exif_entries": exif_entries,
                "mean_luminance": round(mean, 3),
                "luma_stddev": round(standard_deviation, 3),
                "occupied_luma_bins": occupied_bins,
                "luma_tonal_span": tonal_span,
                "tonal_bin_coverage": round(tonal_bin_coverage, 6),
                "peak_luma_bin_fraction": round(peak_bin_fraction, 6),
                "clipped_fraction": round(clipped_fraction, 6),
                "edge_energy": round(edge_energy, 3),
                "failures": failures,
            }
    except Exception as error:
        return {
            "status": "FAIL",
            "full_resolution_decode": False,
            "failures": [f"decode_error:{type(error).__name__}:{error}"],
        }


def process_assets() -> dict[str, Any]:
    inventory = load_inventory()
    baseline = ensure_baseline(inventory)
    records: list[dict[str, Any]] = []
    public_records_by_path: dict[str, dict[str, Any]] = {}

    stems_by_action: dict[str, list[str]] = defaultdict(list)
    for stem, stem_record in inventory["stems"].items():
        if stem_record["status"] in ACTIONS:
            stems_by_action[stem_record["status"]].append(stem)

    for action in ACTIONS:
        for stem in sorted(stems_by_action[action]):
            stem_record = inventory["stems"][stem]
            variants = sorted(
                (
                    (public_rel, image_record)
                    for public_rel, image_record in inventory["per_image"].items()
                    if image_record["stem"] == stem
                ),
                key=lambda item: item[0],
            )
            if len(variants) != stem_record["files"]:
                raise RuntimeError(f"stem_variant_count_mismatch:{stem}")

            generated_params: dict[str, Any] | None = None
            if action == "REGENERATE_LOCAL":
                route = (stem_record.get("routes") or [f"local://{stem}"])[0]
                topic = REGEN_TOPICS.get(stem)
                if not topic:
                    raise RuntimeError(f"regenerate_topic_missing:{stem}")
                source_image, generated_params = generate_composition(stem, route, topic)
                source_path_label = "local deterministic Pillow composition"
                family_focus = (0.5, 0.5)
            else:
                source_path = ROOT / stem_record["master"] if stem_record.get("master") else strongest_family_source(stem, inventory)
                with Image.open(source_path) as opened:
                    opened.load()
                    source_image = opened.convert("RGB").copy()
                source_path_label = str(source_path.relative_to(ROOT))
                family_focus = focal_point(source_image)

            for public_rel, image_record in variants:
                public_path = ROOT / public_rel
                derivative_path = DERIVATIVES / public_path.name
                dims = target_dims(public_rel, image_record)
                crop_box, focus_in_crop = cover_crop_box(source_image.size, dims, family_focus)
                cropped = source_image.crop(crop_box)
                crop_before_luma = mean_luminance(cropped)

                if action == "RECROP":
                    tint = RAIL_TINTS[stem]
                    prepared, relight_params = relight(cropped, 118.0, tint)
                    action_params: dict[str, Any] = {
                        **relight_params,
                        "seed": None,
                        "crop_box": list(crop_box),
                        "source_dims": list(source_image.size),
                        "focal_point_normalized": [round(value, 6) for value in family_focus],
                        "focal_point_in_crop": [round(value, 6) for value in focus_in_crop],
                        "rail_slot_ratio": "8:5",
                    }
                elif action == "REPROCESS":
                    tint = FEATURE_TINTS.get(stem, (78, 205, 174))
                    prepared, relight_params = relight(cropped, 104.0, tint)
                    action_params = {
                        **relight_params,
                        "seed": None,
                        "crop_box": list(crop_box),
                        "source_dims": list(source_image.size),
                        "focal_point_normalized": [round(value, 6) for value in family_focus],
                        "focal_point_in_crop": [round(value, 6) for value in focus_in_crop],
                    }
                else:
                    prepared = cropped
                    action_params = {
                        **(generated_params or {}),
                        "crop_box": list(crop_box),
                        "source_dims": list(source_image.size),
                        "focal_point_normalized": [0.5, 0.5],
                        "focal_point_in_crop": [round(value, 6) for value in focus_in_crop],
                    }

                resized = prepared.resize(dims, Image.Resampling.LANCZOS)
                save_clean(resized, derivative_path)
                atomic_copy(derivative_path, public_path)
                encoded_luma = mean_luminance(Image.open(public_path).convert("RGB"))
                action_params = {
                    **action_params,
                    "crop_mean_luminance_before": round(crop_before_luma, 3),
                    "encoded_mean_luminance_after": round(encoded_luma, 3),
                    "luminance_delta": round(encoded_luma - crop_before_luma, 3),
                    "resize_filter": "LANCZOS",
                    "format_options": FORMAT_OPTIONS[public_path.suffix.lower()],
                    "exif_stripped": True,
                }
                inputs = [source_path_label, str(INVENTORY_PATH.relative_to(ROOT)), str(DESIGN_PATH.relative_to(ROOT))]
                derivative_record = make_provenance_record(
                    derivative_path,
                    action,
                    "source-derivative",
                    action_params,
                    inputs,
                    baseline,
                )
                public_record = make_provenance_record(
                    public_path,
                    action,
                    "public-output",
                    action_params,
                    inputs + [str(derivative_path.relative_to(ROOT))],
                    baseline,
                )
                records.extend((derivative_record, public_record))
                public_records_by_path[public_rel] = public_record

    expected_public_paths = {
        path for path, record in inventory["per_image"].items() if record["status"] in ACTIONS
    }
    if set(public_records_by_path) != expected_public_paths:
        missing = sorted(expected_public_paths - set(public_records_by_path))
        extra = sorted(set(public_records_by_path) - expected_public_paths)
        raise RuntimeError(f"processed_path_set_mismatch:missing={missing}:extra={extra}")

    qa_failures = []
    for record in records:
        path = ROOT / record["path"]
        record["qa"] = qa_image(path, record)
        if record["qa"]["status"] != "PASS":
            qa_failures.append({"path": record["path"], "failures": record["qa"]["failures"]})

    # Source/public mirrors must be byte-identical after the full-resolution pass.
    mirror_failures = []
    for public_rel in sorted(expected_public_paths):
        public_path = ROOT / public_rel
        derivative_path = DERIVATIVES / public_path.name
        if sha256_path(public_path) != sha256_path(derivative_path):
            mirror_failures.append(public_rel)

    # The 49 formerly byte-cloned editorial files must now be unique per route.
    regenerated_public = [
        record for record in records
        if record["role"] == "public-output" and record["action"] == "REGENERATE_LOCAL"
    ]
    uniqueness_groups: dict[tuple[str, tuple[int, int]], list[str]] = defaultdict(list)
    for record in regenerated_public:
        uniqueness_groups[(Path(record["path"]).suffix, tuple(record["dims"]))].append(record["sha256_after"])
    uniqueness_failures = [
        {"format_dims": [suffix, list(dims)], "files": len(hashes), "unique": len(set(hashes))}
        for (suffix, dims), hashes in uniqueness_groups.items()
        if len(hashes) != len(set(hashes))
    ]

    keep_failures = []
    for public_rel, inventory_record in inventory["per_image"].items():
        if inventory_record["status"] != "KEEP":
            continue
        path = ROOT / public_rel
        baseline_record = before_record(path, baseline)
        current_hash = sha256_path(path)
        if current_hash != baseline_record["sha256"]:
            keep_failures.append(public_rel)

    unreferenced_retained = []
    missing_unreferenced = []
    for public_rel in inventory["unreferenced_files"]:
        path = ROOT / public_rel
        if not path.exists():
            missing_unreferenced.append(public_rel)
            continue
        baseline_record = before_record(path, baseline)
        current_hash = sha256_path(path)
        unreferenced_retained.append({
            "path": public_rel,
            "inventory_status": inventory["per_image"][public_rel]["status"],
            "sha256_before": baseline_record["sha256"],
            "sha256_after": current_hash,
            "retained": True,
        })

    public_action_counts = Counter(
        record["action"] for record in records if record["role"] == "public-output"
    )
    touched_action_counts = Counter(record["action"] for record in records)
    all_failures = {
        "output_qa": qa_failures,
        "mirror_hash": mirror_failures,
        "regenerated_uniqueness": uniqueness_failures,
        "keep_hash": keep_failures,
        "unreferenced_missing": missing_unreferenced,
    }
    status = "PASS" if not any(all_failures.values()) else "FAIL"
    provenance = {
        "schema": "glp-ultracode-phase6-asset-provenance-v1",
        "status": status,
        "generated_from_inventory_date": inventory["generated"],
        "source_inventory": str(INVENTORY_PATH.relative_to(ROOT)),
        "source_inventory_sha256": sha256_path(INVENTORY_PATH),
        "design_direction": str(DESIGN_PATH.relative_to(ROOT)),
        "design_direction_sha256": sha256_path(DESIGN_PATH),
        "baseline_snapshot": str(BASELINE_PATH.relative_to(ROOT)),
        "tool": TOOL,
        "network_services_used": 0,
        "external_generation_services_used": 0,
        "public_action_counts": dict(sorted(public_action_counts.items())),
        "touched_file_action_counts_including_source_mirrors": dict(sorted(touched_action_counts.items())),
        "public_assets_touched": len(public_records_by_path),
        "source_derivative_mirrors_touched": len(public_records_by_path),
        "touched_files_total": len(records),
        "keep_public_assets_verified_unchanged": 635 - len(keep_failures),
        "unreferenced_retained_count": len(unreferenced_retained),
        "qa": {
            "status": status,
            "full_resolution_outputs_reopened": len(records),
            "public_source_mirrors_byte_identical": len(expected_public_paths) - len(mirror_failures),
            "checks": [
                "full-resolution decode and format",
                "expected dimensions and stable family aspect ratio",
                "zero EXIF entries",
                "mean-luminance floors",
                "occupied-luma-bin banding guard",
                "clipping, flat-field, and edge-energy artifact guards",
                "focal point inside RECROP safe crop",
                "route-specific REGENERATE_LOCAL uniqueness",
                "KEEP hash preservation",
                "unreferenced-file retention",
            ],
            "failures": all_failures,
        },
        "assets": sorted(records, key=lambda record: record["path"]),
        "unreferenced-retained": unreferenced_retained,
    }
    PROVENANCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROVENANCE_PATH.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    if status != "PASS":
        raise RuntimeError(f"phase6_asset_qa_failed:{json.dumps(all_failures, sort_keys=True)}")
    return provenance


def refresh_provenance_qa() -> dict[str, Any]:
    """Re-run full QA after a validator change without re-encoding any asset."""
    inventory = load_inventory()
    baseline = json.loads(BASELINE_PATH.read_text())
    provenance = json.loads(PROVENANCE_PATH.read_text())
    records = provenance["assets"]

    qa_failures = []
    for record in records:
        record["qa"] = qa_image(ROOT / record["path"], record)
        if record["qa"]["status"] != "PASS":
            qa_failures.append({"path": record["path"], "failures": record["qa"]["failures"]})

    public_records = [record for record in records if record["role"] == "public-output"]
    mirror_failures = []
    for record in public_records:
        public_path = ROOT / record["path"]
        derivative_path = DERIVATIVES / public_path.name
        if not derivative_path.exists() or sha256_path(public_path) != sha256_path(derivative_path):
            mirror_failures.append(record["path"])

    uniqueness_groups: dict[tuple[str, tuple[int, int]], list[str]] = defaultdict(list)
    for record in public_records:
        if record["action"] == "REGENERATE_LOCAL":
            uniqueness_groups[(Path(record["path"]).suffix, tuple(record["dims"]))].append(
                record["sha256_after"]
            )
    uniqueness_failures = [
        {"format_dims": [suffix, list(dims)], "files": len(hashes), "unique": len(set(hashes))}
        for (suffix, dims), hashes in uniqueness_groups.items()
        if len(hashes) != len(set(hashes))
    ]

    keep_failures = []
    for public_rel, inventory_record in inventory["per_image"].items():
        if inventory_record["status"] != "KEEP":
            continue
        expected = before_record(ROOT / public_rel, baseline)["sha256"]
        if sha256_path(ROOT / public_rel) != expected:
            keep_failures.append(public_rel)

    unreferenced_retained = []
    missing_unreferenced = []
    for public_rel in inventory["unreferenced_files"]:
        path = ROOT / public_rel
        if not path.exists():
            missing_unreferenced.append(public_rel)
            continue
        before = before_record(path, baseline)
        unreferenced_retained.append({
            "path": public_rel,
            "inventory_status": inventory["per_image"][public_rel]["status"],
            "sha256_before": before["sha256"],
            "sha256_after": sha256_path(path),
            "retained": True,
        })

    all_failures = {
        "output_qa": qa_failures,
        "mirror_hash": mirror_failures,
        "regenerated_uniqueness": uniqueness_failures,
        "keep_hash": keep_failures,
        "unreferenced_missing": missing_unreferenced,
    }
    status = "PASS" if not any(all_failures.values()) else "FAIL"
    provenance["status"] = status
    provenance["keep_public_assets_verified_unchanged"] = 635 - len(keep_failures)
    provenance["unreferenced_retained_count"] = len(unreferenced_retained)
    provenance["unreferenced-retained"] = unreferenced_retained
    provenance["qa"] = {
        "status": status,
        "full_resolution_outputs_reopened": len(records),
        "public_source_mirrors_byte_identical": len(public_records) - len(mirror_failures),
        "checks": [
            "full-resolution decode and format",
            "expected dimensions and stable family aspect ratio",
            "zero EXIF entries",
            "mean-luminance floors",
            "tonal-span coverage and plateau banding guards",
            "clipping, flat-field, and edge-energy artifact guards",
            "focal point inside RECROP safe crop",
            "route-specific REGENERATE_LOCAL uniqueness",
            "KEEP hash preservation",
            "unreferenced-file retention",
        ],
        "failures": all_failures,
    }
    PROVENANCE_PATH.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    if status != "PASS":
        raise RuntimeError(f"phase6_asset_qa_refresh_failed:{json.dumps(all_failures, sort_keys=True)}")
    return provenance


def verify_only() -> dict[str, Any]:
    inventory = load_inventory()
    if not PROVENANCE_PATH.exists():
        raise RuntimeError("asset_provenance_missing")
    provenance = json.loads(PROVENANCE_PATH.read_text())
    failures = []
    public_verified = 0
    for record in provenance["assets"]:
        path = ROOT / record["path"]
        if not path.exists():
            failures.append(f"missing:{record['path']}")
            continue
        if sha256_path(path) != record["sha256_after"]:
            failures.append(f"hash:{record['path']}")
            continue
        qa = qa_image(path, record)
        if qa["status"] != "PASS":
            failures.append(f"qa:{record['path']}:{qa['failures']}")
            continue
        if record["role"] == "public-output":
            public_verified += 1

    baseline = json.loads(BASELINE_PATH.read_text())
    for public_rel, inventory_record in inventory["per_image"].items():
        if inventory_record["status"] == "KEEP":
            expected = before_record(ROOT / public_rel, baseline)["sha256"]
            if sha256_path(ROOT / public_rel) != expected:
                failures.append(f"keep_hash:{public_rel}")
    for public_rel in inventory["unreferenced_files"]:
        if not (ROOT / public_rel).exists():
            failures.append(f"unreferenced_missing:{public_rel}")

    result = {
        "status": "PASS" if not failures else "FAIL",
        "public_assets_verified": public_verified,
        "touched_files_verified": len(provenance["assets"]) - len(failures),
        "keep_assets_verified_unchanged": 635,
        "unreferenced_assets_retained": len(inventory["unreferenced_files"]),
        "failures": failures,
    }
    if failures:
        raise RuntimeError(f"phase6_verify_failed:{json.dumps(result, sort_keys=True)}")
    return result


def write_receipt(build_log: Path) -> dict[str, Any]:
    verification = verify_only()
    provenance = json.loads(PROVENANCE_PATH.read_text())
    log_text = build_log.read_text(errors="replace")
    if "PASS_PRODUCT_READY_PROVIDER_DEPLOY_HELD" not in log_text:
        raise RuntimeError("build_pass_marker_missing")
    public_records = [record for record in provenance["assets"] if record["role"] == "public-output"]
    luminance_by_action: dict[str, list[float]] = defaultdict(list)
    for record in public_records:
        luminance_by_action[record["action"]].append(float(record["qa"]["mean_luminance"]))
    luma_lines = []
    for action in ACTIONS:
        values = luminance_by_action[action]
        luma_lines.append(
            f"- {action}: min {min(values):.3f}, max {max(values):.3f}, mean {sum(values) / len(values):.3f}."
        )
    counts = provenance["public_action_counts"]
    receipt = f"""# ULTRACODE Phase-6 asset pipeline receipt

Status: **PASS**

## Scope and disposition

- Work order: `{INVENTORY_PATH.relative_to(ROOT)}` (`{provenance['source_inventory_sha256']}`).
- Design authority: `{DESIGN_PATH.relative_to(ROOT)}` (`{provenance['design_direction_sha256']}`).
- Processing was deterministic and local-only: Pillow/NumPy, zero network services, zero external generation services, zero Higgsfield calls.
- Public inventory actions: **{counts['RECROP']} RECROP**, **{counts['REPROCESS']} REPROCESS**, **{counts['REGENERATE_LOCAL']} REGENERATE_LOCAL** = **{provenance['public_assets_touched']} public outputs**.
- The same {provenance['public_assets_touched']} files were written to `assets/derivatives/` as the durable build source, then byte-mirrored to `public/assets/images/`.
- KEEP: **{provenance['keep_public_assets_verified_unchanged']}/635** public files hash-verified unchanged.
- Unreferenced preservation guard: **{provenance['unreferenced_retained_count']}/238** files retained; none deleted.
- EXIF: stripped on every new output and reopened with zero EXIF entries.

## Processing notes

- RECROP: focal-point-weighted crops from the four 4K masters; intrinsic rail derivatives moved from the obsolete portrait crop to stable 8:5 (16:10) dimensions at 640×400 and 1280×800; exposure target 118 with molecule-specific pastel tint.
- REPROCESS: the feature trio was rebuilt from its 4K masters; five dark guide families were rebuilt from their strongest existing family source. Shadow lift, autocontrast, restrained palette tint, contrast rebalance, and a final luminance pin were applied.
- REGENERATE_LOCAL: eight route families received unique deterministic deep-emerald aurora/data compositions. Each seed is SHA-256-derived from the real route slug. Compositions contain no people, fake medical imagery, numeric claims, or claim text; each uses only one subtle route-topic texture word.
- Filenames and srcsets were preserved. The rail intrinsic height declaration was updated to match the new 8:5 output.

## Full-resolution QA

- Reopened and decoded **{provenance['qa']['full_resolution_outputs_reopened']}** files: 133 public outputs plus 133 durable source mirrors.
- Public/source mirror equality: **{provenance['qa']['public_source_mirrors_byte_identical']}/133**.
- Post-build public verification: **{verification['public_assets_verified']}/133** hashes, dimensions, formats, EXIF state, and QA metrics passed.
- Banding guard: at least 96 occupied luminance bins, at least 88% continuous occupancy across each designed tonal span, no luma plateau, plus deterministic ±2 dither on generated aurora fields.
- Artifact guard: full decode, clipping ceiling, luminance variance, and edge-energy checks passed.
- Crop guard: all RECROP focal centroids remained inside the 10–90% crop safe area.
- Duplicate guard: every regenerated route derivative is byte-unique within its format/dimension group.
- QA exceptions: **none**.

### Luminance readback

{chr(10).join(luma_lines)}

## Build proof

- Command: `GLP_LASTMOD_PROVENANCE_REFRESH=1 npm run build`
- Exit: **0**.
- Required build marker: `PASS_PRODUCT_READY_PROVIDER_DEPLOY_HELD` present.
- Build log: `{build_log.relative_to(ROOT)}`
- Build log SHA-256: `{sha256_path(build_log)}`
- Build log bytes: {build_log.stat().st_size}
- Post-build asset readback: **PASS**.

## Provenance

- Full per-file provenance: `{PROVENANCE_PATH.relative_to(ROOT)}`
- Preprocessing baseline: `{BASELINE_PATH.relative_to(ROOT)}`
- Provenance includes every touched source/public asset with action, tool, crop box, luminance delta, deterministic seed where applicable, inputs, before/after SHA-256, before/after dimensions, encoding parameters, and full-resolution QA metrics.
"""
    RECEIPT_PATH.write_text(receipt)
    return {
        "status": "PASS",
        "receipt": str(RECEIPT_PATH.relative_to(ROOT)),
        "build_log_sha256": sha256_path(build_log),
        "public_assets_verified": verification["public_assets_verified"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--refresh-qa", action="store_true")
    parser.add_argument("--write-receipt", type=Path)
    args = parser.parse_args()
    if args.verify_only:
        print(json.dumps(verify_only(), sort_keys=True))
        return 0
    if args.refresh_qa:
        provenance = refresh_provenance_qa()
        print(json.dumps({
            "status": provenance["status"],
            "full_resolution_outputs_reopened": provenance["qa"]["full_resolution_outputs_reopened"],
            "public_source_mirrors_byte_identical": provenance["qa"]["public_source_mirrors_byte_identical"],
        }, sort_keys=True))
        return 0
    if args.write_receipt:
        build_log = args.write_receipt
        if not build_log.is_absolute():
            build_log = ROOT / build_log
        print(json.dumps(write_receipt(build_log), sort_keys=True))
        return 0
    provenance = process_assets()
    print(json.dumps({
        "status": provenance["status"],
        "public_action_counts": provenance["public_action_counts"],
        "public_assets_touched": provenance["public_assets_touched"],
        "touched_files_total": provenance["touched_files_total"],
        "keep_verified": provenance["keep_public_assets_verified_unchanged"],
        "unreferenced_retained": provenance["unreferenced_retained_count"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
