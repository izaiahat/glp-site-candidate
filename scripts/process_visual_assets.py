#!/usr/bin/env python3
"""Derive responsive, EXIF-free web assets and branded OG cards from vetted sources."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "source"
OUT = ROOT / "assets" / "derivatives"
REPORT = Path("/home/ubuntu/business/reports/glp-clinic-scout/phase1-playbook-20260722/visual-asset-manifest.json")
ASSETS = {
    "money-page-hero": "Compare programs without guessing",
    "quiz-hero": "Keep sensitive answers private",
    "directory-hero": "Public records, clearly labeled",
    "editorial-evidence-hero": "Evidence before conclusions",
}
FORMATS = {"avif": {"quality": 68}, "webp": {"quality": 80, "method": 6}, "jpg": {"quality": 84, "optimize": True, "progressive": True}}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def save_web(image: Image.Image, path: Path) -> None:
    kwargs = FORMATS[path.suffix[1:]]
    fmt = "JPEG" if path.suffix == ".jpg" else path.suffix[1:].upper()
    image.save(path, format=fmt, **kwargs)


def font(size: int, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    path = Path("/usr/share/fonts/truetype/dejavu") / name
    return ImageFont.truetype(str(path), size)


def make_og(image: Image.Image, title: str, out: Path) -> None:
    canvas = fit(image, 1200, 630).convert("RGBA")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x in range(780):
        alpha = round(225 * (1 - x / 780) ** 1.7)
        draw.line((x, 0, x, 630), fill=(16, 35, 59, alpha))
    canvas = Image.alpha_composite(canvas, overlay)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((58, 54, 114, 110), radius=15, fill="#d94f35")
    draw.text((72, 57), "✓", font=font(34, True), fill="white")
    draw.text((132, 63), "CLINIC SCOUT", font=font(28, True), fill="#d7e9de")
    words = title.split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font(58, True)) > 610 and current:
            lines.append(current); current = word
        else:
            current = trial
    lines.append(current)
    y = 180
    for line in lines:
        draw.text((58, y), line, font=font(58, True), fill="white", stroke_width=1, stroke_fill="#10233b")
        y += 72
    draw.text((60, 526), "Evidence-first consumer comparison · staging", font=font(23), fill="#f7f5ef")
    save_web(canvas.convert("RGB"), out)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "clinic-scout-visual-assets-v1", "assets": [], "exif_stripped": True}
    for slug, title in ASSETS.items():
        source = SOURCE / f"{slug}.source"
        with Image.open(source) as original:
            rgb = original.convert("RGB")
            for width, height in ((1600, 900), (800, 450)):
                variant = fit(rgb, width, height)
                for extension in FORMATS:
                    output = OUT / f"{slug}-{width}.{extension}"
                    save_web(variant, output)
                    manifest["assets"].append({"path": output.name, "role": "hero", "width": width, "height": height, "bytes": output.stat().st_size, "sha256": sha(output)})
            og = OUT / f"{slug}-og.jpg"
            make_og(rgb, title, og)
            manifest["assets"].append({"path": og.name, "role": "og", "width": 1200, "height": 630, "bytes": og.stat().st_size, "sha256": sha(og)})
    REPORT.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    max_mobile = max(item["bytes"] for item in manifest["assets"] if item["role"] == "hero" and item["width"] == 800)
    max_desktop = max(item["bytes"] for item in manifest["assets"] if item["role"] == "hero" and item["width"] == 1600)
    print(json.dumps({"status": "PASS", "asset_files": len(manifest["assets"]), "max_mobile_bytes": max_mobile, "max_desktop_bytes": max_desktop}))


if __name__ == "__main__":
    main()
