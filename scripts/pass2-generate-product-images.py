#!/usr/bin/env python3
"""Generate resumable product-comparison artwork for Pass 2 category routes."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from typing import Any
import urllib.request

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
REPORT = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-product-image-generation")
MASTER_DIR = ROOT / "assets/source/product-comparison-pass2"
DERIVATIVE_DIR = ROOT / "assets/derivatives/product-comparison-pass2"
STATE_PATH = REPORT / "state.json"
MANIFEST_PATH = ROOT / "artifacts/ultracode/pass2-product-comparison-image-manifest.json"
MODEL = "gpt_image_2"
LOCK = threading.Lock()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text()) if path.exists() else {}


def download_image(urls: list[str], stem: str) -> tuple[Path, str]:
    last_error = "no URL candidates"
    for url in urls:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "GLPClinicScout-Pass2/1.0"})
            with urllib.request.urlopen(request, timeout=180) as response:
                content_type = response.headers.get_content_type()
                if not content_type.startswith("image/"):
                    continue
                payload = response.read(40_000_000)
            extension = mimetypes.guess_extension(content_type) or ".img"
            if extension == ".jpe":
                extension = ".jpg"
            output = MASTER_DIR / f"{stem}-raw{extension}"
            output.write_bytes(payload)
            return output, content_type
        except Exception as error:  # noqa: BLE001
            last_error = f"{type(error).__name__}: {error}"
    raise RuntimeError(f"no downloadable image result: {last_error}")


def call_higgsfield(image_prompt: str, stem: str) -> tuple[Path, str, dict[str, Any]]:
    command = [shutil.which("higgsfield") or "higgsfield", "generate", "create", MODEL, "--prompt", image_prompt, "--aspect_ratio", "16:9", "--quality", "high", "--resolution", "4k", "--wait", "--wait-timeout", "30m", "--json"]
    started = time.time()
    result = subprocess.run(command, text=True, capture_output=True, timeout=2100, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"higgsfield exited {result.returncode}: {result.stderr[-500:]}")
    urls = backend.recursive_urls(json.loads(result.stdout))
    raw, content_type = download_image(urls, stem)
    return raw, content_type, {"elapsed_seconds": round(time.time() - started, 2), "result_url_count": len(urls)}


def write_derivatives(master: Path, stem: str) -> list[dict[str, Any]]:
    outputs: list[dict[str, Any]] = []
    with Image.open(master) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        widths = (384, 640, 1280) if stem == "brand-wegovy" else (640, 1280)
        for width in widths:
            height = round(width * 9 / 16)
            rendered = ImageOps.fit(source, (width, height), method=Image.Resampling.LANCZOS)
            for extension, image_format, options in (("avif", "AVIF", {"quality": 72}), ("webp", "WEBP", {"quality": 82, "method": 6}), ("jpg", "JPEG", {"quality": 86, "optimize": True, "progressive": True})):
                path = DERIVATIVE_DIR / f"{stem}-{width}.{extension}"
                rendered.save(path, image_format, **options)
                outputs.append({"path": str(path.relative_to(ROOT)), "width": width, "height": height, "format": extension, "bytes": path.stat().st_size, "sha256": sha(path)})
    return outputs


def load_backend():
    path = ROOT / "scripts/pass2-generate-provider-review-images.py"
    spec = importlib.util.spec_from_file_location("pass2_provider_backend", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("provider_image_backend_unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def products() -> list[dict[str, str]]:
    graph = json.loads((ROOT / "data/phase3-page-graph.json").read_text())
    rows: list[dict[str, str]] = []
    for page in graph.get("brand_pages", []):
        rows.append({"id": f"brand-{page['slug']}", "title": page["name"], "route": page["route"], "kind": "brand", "ingredient": page.get("ingredient", "GLP-1 medication")})
    for page in graph.get("compounded_pages", []):
        rows.append({"id": f"compounded-{page['medication_id']}", "title": page["name"], "route": page["route"], "kind": "compounded", "ingredient": page.get("name", "compounded GLP-1")})
    for page in graph.get("bulk_pages", []):
        rows.append({"id": f"bulk-{page['duration_months']}-month", "title": page["name"], "route": page["route"], "kind": "bulk", "ingredient": f"{page['duration_months']}-month planning"})
    rows.sort(key=lambda row: row["id"])
    if len(rows) != 9 or len({row["route"] for row in rows}) != 9:
        raise RuntimeError(f"product_contract_invalid:{len(rows)}")
    return rows


def prompt(row: dict[str, str]) -> str:
    seed = {
        "brand": "a blank product-status dossier, neutral option cards, an unmarked pen, and a clean treatment-comparison ruler",
        "compounded": "blank dose-grid cards, an unmarked laboratory glass form, a neutral verification seal, and source folders",
        "bulk": "three blank monthly planning cards, a neutral calendar rail, evidence folders, and an unmarked calculator",
    }[row["kind"]]
    return (
        f"Premium photorealistic editorial comparison still life for the Clinic Scout {row['title']} route. "
        f"Build a route-specific composition around {seed}. Represent the subject {row['ingredient']} only through neutral research objects and composition, never through branded packaging. "
        "Dark emerald near-black stone desk, cream evidence cards, restrained brass accents, warm directional studio light, subtle cyan edge light, premium investigative magazine art direction. "
        "Wide 16:9 composition with useful negative space for responsive interface copy. No text, letters, numbers, labels, logos, trademarks, ratings, testimonials, medical claims, people, faces, needles, syringes, pills, or recognizable drug packaging. "
        "Every object must be physically coherent. High-end commercial still-life photography, not illustration, not generic stock art, no reused competitor assets."
    )


def write_state(state: dict[str, Any]) -> None:
    atomic_json(STATE_PATH, state)


def generate(row: dict[str, str], state: dict[str, Any], force: bool) -> dict[str, Any]:
    stem = row["id"]
    master = MASTER_DIR / f"{stem}.webp"
    if force or not master.exists():
        raw, _, meta = call_higgsfield(prompt(row), f"product-{stem}")
        with Image.open(raw) as image:
            image = image.convert("RGB")
            image = ImageOps.fit(image, (1600, 900), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
            image.save(master, "WEBP", quality=96, method=6)
    else:
        meta = {"status": "REUSED_EXISTING_MASTER"}
    outputs = write_derivatives(master, stem)
    result = {
        **row,
        "status": "PASS",
        "model": MODEL,
        "master_path": str(master.relative_to(ROOT)),
        "master_sha256": sha(master),
        "prompt_sha256": hashlib.sha256(prompt(row).encode()).hexdigest(),
        "outputs": outputs,
        "provider_metadata": meta,
    }
    with LOCK:
        state["records"] = [item for item in state.get("records", []) if item.get("id") != stem] + [result]
        state["records"].sort(key=lambda item: item["id"])
        state["completed"] = len(state["records"])
        state["remaining"] = state["expected"] - state["completed"]
        state["status"] = "PASS" if state["remaining"] == 0 else "IN_PROGRESS"
        write_state(state)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 3:
        raise SystemExit("workers must be 1..3")
    os.umask(0o077)
    for path in (REPORT, MASTER_DIR, DERIVATIVE_DIR, MANIFEST_PATH.parent):
        path.mkdir(parents=True, exist_ok=True)
    rows = products()
    previous = load_json(STATE_PATH)
    previous_records = {row["id"]: row for row in previous.get("records", []) if row.get("status") == "PASS"}
    reusable: dict[str, dict[str, Any]] = {}
    if not args.force:
        for row in rows:
            record = previous_records.get(row["id"])
            if not record:
                continue
            master = ROOT / record["master_path"]
            if not master.exists():
                continue
            expected_widths = {384, 640, 1280} if row["id"] == "brand-wegovy" else {640, 1280}
            recorded_widths = {int(output.get("width", 0)) for output in record.get("outputs", [])}
            outputs_exist = all((ROOT / output.get("path", "")).is_file() for output in record.get("outputs", []))
            if recorded_widths != expected_widths or not outputs_exist:
                record = {**record, "outputs": write_derivatives(master, row["id"])}
            reusable[row["id"]] = record
    state = {"schema": "glp-pass2-product-comparison-images-v1", "status": "IN_PROGRESS", "expected": len(rows), "completed": len(reusable), "remaining": len(rows) - len(reusable), "records": list(reusable.values())}
    state["records"].sort(key=lambda item: item["id"])
    write_state(state)
    pending = [row for row in rows if row["id"] not in reusable]
    if pending:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(generate, row, state, args.force) for row in pending]
            for future in concurrent.futures.as_completed(futures):
                future.result()
    state["status"] = "PASS" if state["completed"] == state["expected"] else "BLOCKED"
    write_state(state)
    manifest = {"schema": "glp-pass2-product-comparison-image-manifest-v1", "status": state["status"], "expected": state["expected"], "records": state["records"]}
    atomic_json(MANIFEST_PATH, manifest)
    print(json.dumps({"status": state["status"], "completed": state["completed"], "expected": state["expected"], "manifest": str(MANIFEST_PATH)}))
    return 0 if state["status"] == "PASS" else 1


backend = load_backend()

if __name__ == "__main__":
    raise SystemExit(main())
