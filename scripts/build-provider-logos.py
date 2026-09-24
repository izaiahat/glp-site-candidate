#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import io
import json
import re
import ssl
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "data" / "provider-logo-sources.json"
OUTPUT_DIR = ROOT / "assets" / "provider-logos"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
MAX_BYTES = 6_000_000
MAX_PIXELS = 12_000_000
MAX_WIDTH = 480
MAX_HEIGHT = 180
USER_AGENT = "ClinicScoutStagingAssetBuilder/1.0 (+https://glpclinicscout.com)"
DANGEROUS_TAGS = {"script", "foreignObject", "iframe", "object", "embed", "image", "audio", "video"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> tuple[bytes, str, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"asset_url_not_https:{url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,text/html;q=0.8"})
    with urllib.request.urlopen(request, timeout=45, context=ssl.create_default_context()) as response:
        final = urllib.parse.urlparse(response.geturl())
        if final.scheme != "https" or not final.hostname:
            raise ValueError(f"redirect_not_https:{url}")
        original_host = parsed.hostname.lower().removeprefix("www.")
        final_host = final.hostname.lower().removeprefix("www.")
        if original_host != final_host:
            raise ValueError(f"redirect_host_changed:{parsed.hostname}:{final.hostname}")
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"asset_too_large:{url}")
        return data, response.headers.get_content_type(), response.geturl()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sanitize_svg(raw: bytes) -> tuple[bytes, int, int]:
    if len(raw) > MAX_BYTES:
        raise ValueError("svg_too_large")
    root = ET.fromstring(raw)
    if local_name(root.tag) != "svg":
        raise ValueError("svg_root_invalid")
    for element in root.iter():
        tag = local_name(element.tag)
        if tag in DANGEROUS_TAGS:
            raise ValueError(f"svg_dangerous_tag:{tag}")
        for key, value in element.attrib.items():
            attr = local_name(key).lower()
            lowered = str(value).strip().lower()
            if attr.startswith("on"):
                raise ValueError(f"svg_event_attribute:{attr}")
            if attr in {"href", "src"} and lowered and not lowered.startswith("#"):
                raise ValueError(f"svg_external_reference:{attr}")
            local_paint = re.fullmatch(r"url\(\s*#[A-Za-z0-9_.:-]+\s*\)", lowered)
            if "javascript:" in lowered or ("url(" in lowered and not local_paint):
                raise ValueError(f"svg_active_value:{attr}")
    view_box = root.attrib.get("viewBox", "").split()
    if len(view_box) == 4:
        width = max(1, round(float(view_box[2])))
        height = max(1, round(float(view_box[3])))
    else:
        width = max(1, round(float(re.sub(r"[^0-9.]", "", root.attrib.get("width", "240")) or 240)))
        height = max(1, round(float(re.sub(r"[^0-9.]", "", root.attrib.get("height", "80")) or 80)))
        root.set("viewBox", f"0 0 {width} {height}")
    root.attrib.pop("class", None)
    root.set("role", "img")
    root.set("focusable", "false")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    output = ET.tostring(root, encoding="utf-8", xml_declaration=False)
    return output + b"\n", width, height


def extract_inline_svg(page: bytes, selector_class: str) -> bytes:
    text = page.decode("utf-8", "ignore")
    pattern = re.compile(rf"(<svg\b[^>]*class=[\"'][^\"']*\b{re.escape(selector_class)}\b[^\"']*[\"'][^>]*>[\s\S]*?</svg>)", re.I)
    match = pattern.search(text)
    if not match:
        raise ValueError(f"inline_svg_missing:{selector_class}")
    return html.unescape(match.group(1)).encode("utf-8")


def healthrx_lockup(page: bytes) -> bytes:
    text = page.decode("utf-8", "ignore")
    if 'class="site-nav-logo"' not in text or "Health<span" not in text or "Rx</span>" not in text:
        raise ValueError("healthrx_text_lockup_marker_missing")
    return b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 310 72" role="img" aria-labelledby="title"><title id="title">HealthRx.com</title><rect x="4" y="8" width="56" height="56" rx="17" fill="#0E4F4F"/><text x="17" y="45" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="27" fill="#FDFAF2">Rx</text><text x="76" y="45" font-family="Georgia,serif" font-weight="700" font-size="34" fill="#0E0E0C">Health</text><text x="181" y="45" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="34" fill="#0E4F4F">Rx</text><text x="224" y="45" font-family="Arial,sans-serif" font-weight="600" font-size="19" fill="#6E6A60">.com</text></svg>\n'''


def extract_embedded_raster_svg(raw: bytes) -> bytes:
    root = ET.fromstring(raw)
    images = [element for element in root.iter() if local_name(element.tag) == "image"]
    if len(images) != 1:
        raise ValueError("embedded_raster_svg_image_count_invalid")
    href = next((value for key, value in images[0].attrib.items() if local_name(key).lower() == "href"), "")
    match = re.fullmatch(r"data:image/(png|webp);base64,([A-Za-z0-9+/=\s]+)", href)
    if not match:
        raise ValueError("embedded_raster_svg_href_invalid")
    decoded = base64.b64decode(match.group(2), validate=True)
    if len(decoded) > MAX_BYTES:
        raise ValueError("embedded_raster_svg_too_large")
    return decoded


def optimize_raster(raw: bytes) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(raw)) as image:
        image.load()
        if image.width * image.height > MAX_PIXELS:
            raise ValueError(f"raster_pixel_cap:{image.width}x{image.height}")
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        bbox = alpha.getbbox()
        if bbox:
            rgba = rgba.crop(bbox)
        rgba.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.Resampling.LANCZOS)
        pad_x, pad_y = max(8, round(rgba.width * 0.03)), max(6, round(rgba.height * 0.08))
        rgba = ImageOps.expand(rgba, border=(pad_x, pad_y), fill=(0, 0, 0, 0))
        output = io.BytesIO()
        rgba.save(output, format="WEBP", quality=90, method=6, lossless=rgba.width * rgba.height < 35_000)
        return output.getvalue(), rgba.width, rgba.height


def main() -> None:
    parser = argparse.ArgumentParser()
    # The expected count stays a hard assertion so a silently truncated or
    # silently grown sources file still fails the build; it is now declared by
    # the caller instead of frozen at the wave-2 snapshot of 18.
    parser.add_argument("--expect-count", type=int, default=18)
    args = parser.parse_args()
    source = json.loads(SOURCE_PATH.read_text())
    programs = source["programs"]
    ids = [item["program_id"] for item in programs]
    if len(programs) != args.expect_count or len(ids) != len(set(ids)):
        raise ValueError("provider_logo_source_count_or_uniqueness_invalid")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    allowed = {item["output_file"] for item in programs} | {"manifest.json"}
    for existing in OUTPUT_DIR.iterdir():
        if existing.is_file() and existing.name not in allowed:
            existing.unlink()
    receipts = []
    for item in programs:
        output_path = OUTPUT_DIR / item["output_file"]
        kind = item["source_kind"]
        if kind in {"remote_image", "embedded_raster_svg"}:
            raw, content_type, final_url = fetch(item["asset_url"])
            if kind == "embedded_raster_svg":
                raw = extract_embedded_raster_svg(raw)
                rendered, width, height = optimize_raster(raw)
                media_type = "image/webp"
            elif content_type == "image/svg+xml" or raw.lstrip().startswith(b"<svg") or item["output_file"].endswith(".svg"):
                rendered, width, height = sanitize_svg(raw)
                media_type = "image/svg+xml"
            else:
                rendered, width, height = optimize_raster(raw)
                media_type = "image/webp"
        elif kind in {"inline_svg", "first_party_text_lockup"}:
            page, content_type, final_url = fetch(item["source_page_url"])
            raw = extract_inline_svg(page, item["selector_class"]) if kind == "inline_svg" else healthrx_lockup(page)
            rendered, width, height = sanitize_svg(raw)
            media_type = "image/svg+xml"
        elif kind == "prevalidated_local":
            local_path = (ROOT / item["local_file"]).resolve()
            if not local_path.is_relative_to(ROOT) or not local_path.is_file():
                raise ValueError(f"prevalidated_local_path_invalid:{item['program_id']}")
            raw = local_path.read_bytes()
            if sha256(raw) != item["expected_sha256"]:
                raise ValueError(f"prevalidated_local_hash_invalid:{item['program_id']}")
            if item["output_file"].endswith(".svg"):
                _, width, height = sanitize_svg(raw)
                media_type = "image/svg+xml"
            else:
                with Image.open(io.BytesIO(raw)) as image:
                    image.verify()
                with Image.open(io.BytesIO(raw)) as image:
                    width, height = image.size
                media_type = "image/webp"
            rendered = raw
            final_url = item["asset_url"]
        else:
            raise ValueError(f"source_kind_invalid:{kind}")
        output_path.write_bytes(rendered)
        receipts.append({
            "program_id": item["program_id"],
            "provider": item["provider"],
            "source_page_url": item["source_page_url"],
            "source_kind": kind,
            "source_asset_url": item.get("asset_url"),
            "resolved_url": final_url,
            "raw_sha256": sha256(raw),
            "public_path": f"/assets/provider-logos/{item['output_file']}",
            "output_file": item["output_file"],
            "output_sha256": sha256(rendered),
            "bytes": len(rendered),
            "width": width,
            "height": height,
            "media_type": media_type,
            "surface": item["surface"],
            "verified_as_of": item.get("verified_as_of", source["verified_as_of"]),
            "runtime_remote_load": False,
        })
    manifest = {
        "schema": "glp-provider-logo-manifest-v1",
        "status": "PASS",
        "verified_as_of": source["verified_as_of"],
        "source_manifest_sha256": sha256(SOURCE_PATH.read_bytes()),
        "count": len(receipts),
        "runtime_remote_assets": 0,
        "logos": receipts,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "logos": len(receipts), "manifest": str(MANIFEST_PATH)}))


if __name__ == "__main__":
    main()
