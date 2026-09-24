#!/usr/bin/env python3
"""Generate resumable provider/review house-style scenes from governed provider identities."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.request

from PIL import Image, ImageOps

ROOT = Path("/home/ubuntu/business/site-system/flagship-v2/candidates/glp-visual-ultracode-20260821")
REGISTRY_PATH = ROOT / "data/program-registry.json"
GRAPH_PATH = ROOT / "data/phase3-page-graph.json"
MASTER_DIR = ROOT / "assets/source/provider-review-masters-pass2"
DERIVATIVE_DIR = ROOT / "assets/derivatives/provider-review-pass2"
REPORT_DIR = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-provider-review-image-generation")
RAW_DIR = REPORT_DIR / "raw"
STATE_PATH = REPORT_DIR / "state.json"
MANIFEST_PATH = ROOT / "artifacts/ultracode/pass2-provider-review-image-manifest.json"
MODEL = "gpt_image_2"
STATE_LOCK = threading.Lock()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def provider_records() -> list[dict]:
    registry = json.loads(REGISTRY_PATH.read_text())
    graph = json.loads(GRAPH_PATH.read_text())
    rows = [
        {
            "program_id": row["program_id"],
            "display_name": row["display_name"],
            "review_path": row.get("review_path"),
            "commercial_facts_status": row.get("commercial_state") or "unbound",
        }
        for row in registry.get("programs", [])
    ]
    seen = {row["program_id"] for row in rows}
    for row in graph.get("provider_work_order_additions", []):
        if row["program_id"] in seen:
            continue
        rows.append(
            {
                "program_id": row["program_id"],
                "display_name": row["display_name"],
                "review_path": row.get("review_path"),
                "commercial_facts_status": row.get("commercial_facts_status") or "unbound",
            }
        )
    rows.sort(key=lambda row: row["display_name"].casefold())
    if len(rows) != 35 or len({row["program_id"] for row in rows}) != 35:
        raise RuntimeError(f"expected 35 unique provider identities, found {len(rows)}")
    return rows


def composition(program_id: str) -> str:
    digest = int(hashlib.sha256(program_id.encode()).hexdigest()[:12], 16)
    lenses = [
        "50mm eye-level editorial view",
        "85mm close evidence-desk view",
        "35mm three-quarter studio view",
        "70mm low-angle documentary still life",
        "top-down 45mm evidence-layout view",
        "100mm macro-detail editorial view",
        "40mm side-profile studio view",
    ]
    surfaces = [
        "deep navy stone",
        "mineral teal glass",
        "warm gray laboratory paper",
        "brushed dark aluminum",
        "smoked translucent acrylic",
        "matte pale mineral composite",
    ]
    arrangements = [
        "a diagonal evidence flow",
        "three distinct depth planes",
        "a balanced split composition",
        "an asymmetric editorial cluster",
        "a restrained radial arrangement",
        "a single foreground dossier with supporting evidence behind it",
    ]
    side = "right" if digest % 2 else "left"
    return f"{lenses[digest % len(lenses)]} on {surfaces[(digest // 7) % len(surfaces)]}, {arrangements[(digest // 13) % len(arrangements)]}, dominant objects weighted to the {side} with clean negative space opposite"


def prompt_for(record: dict) -> tuple[str, str]:
    subject = f"Provider-specific editorial evidence scene for the governed Clinic Scout identity {record['display_name']}."
    prompt = (
        f"Create a premium photorealistic 16:9 editorial scene for an independent healthcare comparison profile of {record['display_name']}. "
        "The scene is a neutral evidence desk, not an advertisement: one blank source dossier, a phone-shaped telehealth intake panel with an empty screen, an insulated fulfillment parcel with no markings, a magnifying lens, and several blank citation tabs. "
        f"Composition: {composition(record['program_id'])}. "
        "House style: deep navy, mineral teal, restrained warm amber, soft aurora reflections, physically plausible glass, paper, aluminum, and controlled clinical materials. "
        "Keep a clean negative-space area where the real governed provider logo and page copy will be overlaid separately in HTML. No people and no implied treatment outcome. "
        "All objects must be unbranded and every label, paper, package, and screen must be blank and illegible. Do not draw or imitate the provider logo. "
        "Negative prompt: visible words, letters, numbers, logos, trademarks, copied packaging, invented branded packaging, medication claims, prices, ratings, testimonials, before-and-after imagery, clinical outcomes, fake patient evidence, fake clinicians, watermarks, malformed objects, floating pills, syringe spectacle, generic wellness filler, competitor-identifying elements."
    )
    return subject, prompt


def recursive_urls(value: object) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for child in value.values():
            found.extend(recursive_urls(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(recursive_urls(child))
    elif isinstance(value, str) and value.startswith(("https://", "http://")):
        found.append(value)
    return list(dict.fromkeys(found))


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
            output = MASTER_DIR / f"{stem}{extension}"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(payload)
            return output, content_type
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"
    raise RuntimeError(f"no downloadable image result: {last_error}")


def dimensions(path: Path) -> tuple[int, int, str]:
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        return image.width, image.height, image.format or "unknown"


def derivatives(master: Path, stem: str) -> list[dict]:
    outputs: list[dict] = []
    with Image.open(master) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        for width in (640, 1280):
            height = round(width * 9 / 16)
            rendered = ImageOps.fit(source, (width, height), method=Image.Resampling.LANCZOS)
            for extension, image_format, options in (
                ("avif", "AVIF", {"quality": 72}),
                ("webp", "WEBP", {"quality": 82, "method": 6}),
                ("jpg", "JPEG", {"quality": 86, "optimize": True, "progressive": True}),
            ):
                path = DERIVATIVE_DIR / f"{stem}-{width}.{extension}"
                path.parent.mkdir(parents=True, exist_ok=True)
                rendered.save(path, image_format, **options)
                outputs.append({
                    "path": str(path.relative_to(ROOT)),
                    "width": width,
                    "height": height,
                    "format": extension,
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                })
    return outputs


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {
        "schema": "glp-pass2-provider-review-image-generation-v1",
        "model": "GPT Image 2",
        "job_set_type": MODEL,
        "quality": "high",
        "resolution": "4k",
        "aspect_ratio": "16:9",
        "records": {},
    }


def passed_record(record: dict) -> bool:
    output = Path(record.get("output_path", "")) if record.get("output_path") else None
    if record.get("status") != "PASS" or not output or not output.exists():
        return False
    width, height, _ = dimensions(output)
    if width < 2400 or height < 1200 or record.get("output_sha256") != sha256(output):
        return False
    return len(record.get("derivatives", [])) == 6 and all((ROOT / item["path"]).exists() and sha256(ROOT / item["path"]) == item["sha256"] for item in record["derivatives"])


def generate_one(record: dict, state: dict) -> dict:
    program_id = record["program_id"]
    prior = state["records"].get(program_id) or {}
    if passed_record(prior):
        return prior
    subject, prompt = prompt_for(record)
    command = [
        shutil.which("higgsfield") or "higgsfield",
        "generate", "create", MODEL,
        "--prompt", prompt,
        "--aspect_ratio", "16:9",
        "--quality", "high",
        "--resolution", "4k",
        "--wait", "--wait-timeout", "30m",
        "--json",
    ]
    started = time.time()
    result = subprocess.run(command, text=True, capture_output=True, timeout=2100, check=False)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = RAW_DIR / f"{program_id}.json"
    atomic_json(raw_path, {
        "program_id": program_id,
        "display_name": record["display_name"],
        "subject": subject,
        "prompt": prompt,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    })
    output_record = {
        **record,
        "subject": subject,
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "raw_receipt": str(raw_path),
        "elapsed_seconds": round(time.time() - started, 2),
        "status": "FAIL",
    }
    try:
        if result.returncode != 0:
            raise RuntimeError(f"higgsfield exited {result.returncode}: {result.stderr[-500:]}")
        urls = recursive_urls(json.loads(result.stdout))
        output, content_type = download_image(urls, program_id)
        width, height, image_format = dimensions(output)
        if width < 2400 or height < 1200:
            raise RuntimeError(f"generated master below threshold: {width}x{height}")
        output_record.update({
            "status": "PASS",
            "output_path": str(output),
            "output_relative_path": str(output.relative_to(ROOT)),
            "output_sha256": sha256(output),
            "output_bytes": output.stat().st_size,
            "width": width,
            "height": height,
            "format": image_format,
            "content_type": content_type,
            "result_url_count": len(urls),
            "derivatives": derivatives(output, program_id),
        })
    except Exception as exc:  # noqa: BLE001
        output_record["error"] = f"{type(exc).__name__}: {exc}"
    with STATE_LOCK:
        state["records"][program_id] = output_record
        state["updated_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_json(STATE_PATH, state)
    return output_record


def write_manifest(records: list[dict], state: dict) -> dict:
    ordered = [state["records"].get(record["program_id"], {**record, "status": "MISSING"}) for record in records]
    passed = [record for record in ordered if passed_record(record)]
    master_hashes = [record["output_sha256"] for record in passed]
    derivative_hashes = [item["sha256"] for record in passed for item in record["derivatives"]]
    manifest = {
        "schema": "glp-pass2-provider-review-image-manifest-v1",
        "status": "PASS" if len(passed) == len(records) and len(set(master_hashes)) == len(records) and len(set(derivative_hashes)) == len(records) * 6 else "BLOCKED",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provider_count": len(records),
        "passed_count": len(passed),
        "unique_master_hashes": len(set(master_hashes)),
        "derivative_count": len(derivative_hashes),
        "unique_derivative_hashes": len(set(derivative_hashes)),
        "provider_calls_during_build": 0,
        "records": ordered,
    }
    atomic_json(MANIFEST_PATH, manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.workers <= 4:
        raise SystemExit("workers must be between 1 and 4")
    records = provider_records()
    state = load_state()
    pending = [record for record in records if not passed_record(state["records"].get(record["program_id"], {}))]
    if args.limit:
        pending = pending[: args.limit]
    outcomes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(generate_one, record, state) for record in pending]
        for future in concurrent.futures.as_completed(futures):
            outcome = future.result()
            outcomes.append(outcome)
            print(json.dumps({"program_id": outcome["program_id"], "status": outcome["status"], "elapsed_seconds": outcome.get("elapsed_seconds")}), flush=True)
    state = load_state()
    manifest = write_manifest(records, state)
    summary = {
        "status": manifest["status"],
        "generated_this_run": len(outcomes),
        "passed_total": manifest["passed_count"],
        "remaining": manifest["provider_count"] - manifest["passed_count"],
        "manifest": str(MANIFEST_PATH),
    }
    print(json.dumps(summary), flush=True)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
