#!/usr/bin/env python3
"""Generate resumable route-specific PASS 2 article masters with Higgsfield GPT Image 2."""

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

from PIL import Image

CANDIDATE = Path("/home/ubuntu/business/site-system/flagship-v2/candidates/glp-visual-ultracode-20260821")
DERIVATIVE_MANIFEST = CANDIDATE / "artifacts/ultracode/pass2-image-derivative-manifest.json"
OUTPUT_DIR = CANDIDATE / "assets/source/article-masters-pass2"
REPORT_DIR = Path("/home/ubuntu/business/reports/glp-clinic-scout/rebuild/pass2-image-generation")
STATE_PATH = REPORT_DIR / "state.json"
RAW_DIR = REPORT_DIR / "raw"
MODEL = "gpt_image_2"
STATE_LOCK = threading.Lock()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {
            "schema": "glp-pass2-route-image-generation-v1",
            "model": "GPT Image 2",
            "job_set_type": MODEL,
            "quality": "high",
            "resolution": "4k",
            "aspect_ratio": "16:9",
            "records": {},
        }
    return json.loads(STATE_PATH.read_text())


def slug_title(route: str) -> str:
    stem = route.strip("/").split("/")[-1]
    substitutions = {
        "glp-1": "GLP-1",
        "hsa": "HSA",
        "fsa": "FSA",
        "fda": "FDA",
        "trt": "TRT",
        "ed": "ED",
        "cgm": "CGM",
        "cjc": "CJC",
        "bpc": "BPC",
    }
    words = stem.split("-")
    rendered = []
    index = 0
    while index < len(words):
        matched = False
        for size in (3, 2, 1):
            token = "-".join(words[index : index + size])
            if token in substitutions:
                rendered.append(substitutions[token])
                index += size
                matched = True
                break
        if not matched:
            rendered.append(words[index].capitalize())
            index += 1
    return " ".join(rendered)


ROUTE_SCENE_OVERRIDES = {
    "/guides/bpc-157-fda-status-and-evidence/": "a research-only amber vial beside a microplate assay tray, a sealed evidence archive, and a restrained caution seal shape with no text",
    "/guides/brand-vs-compounded-glp-1-cost/": "a balanced split between an unbranded cold-chain pen-shaped device and an unbranded compounding vial, joined by a long receipt ribbon and a neutral balance scale",
    "/guides/cheapest-glp1/": "three unbranded insulated treatment parcels arranged low-to-high with coin-like discs, one neutral vial, and blank price tags of visibly different sizes",
    "/guides/cjc-1295-ipamorelin-regulatory-status/": "an unbranded research vial beside a chromatography sample tray, a chain-of-custody tag with no text, and a molecular glass sculpture",
    "/guides/compare-online-glp-1-provider-fees/": "stacked translucent service-layer blocks, a segmented blank invoice, a neutral payment card, and a magnifying lens revealing separate fee layers",
    "/guides/compounded-semaglutide-vs-ozempic-regulatory-status/": "a side-by-side unbranded pen-shaped device and compounding vial separated by an inspection seal, a cold-chain pouch, and a blank regulator evidence folder",
    "/guides/compounded-tirzepatide-vs-zepbound-regulatory-status/": "two contrasting unbranded cold-chain kits, one pen-shaped and one vial-based, separated by tamper seals and a blank pharmacy inspection card",
    "/guides/erectile-dysfunction-evidence-overview/": "a discreet navy medicine case with two different unbranded tablet blisters, a glass of water, and a closed evidence dossier on dark stone",
    "/guides/finasteride-evidence-and-options/": "a macro hair-follicle glass model, a fine comb, an unbranded tablet blister, and a closed dermatology evidence folio",
    "/guides/found-vs-trimi-insurance-self-pay/": "a split telehealth comparison with an insurance card under a translucent protective shield on one side and a wallet with coin-like discs on the other, plus two distinct unbranded fulfillment parcels",
    "/guides/gala-vs-shed/": "two visibly different unbranded telehealth fulfillment kits, one bottle-and-dropper set and one vial-and-cold-pack set, separated by a neutral measuring ruler",
    "/guides/glp-1-hsa-fsa-reimbursement-evidence/": "an unbranded HSA-style payment card, a receipt envelope, a calendar tile, and a reimbursement stamp shape with no words",
    "/guides/glp-1-insurance-support-vs-coverage/": "a translucent protective umbrella form over an insurance card and treatment parcel contrasted with an uncovered wallet and neutral payment discs",
    "/guides/glp-1-prior-authorization-appeals/": "layered authorization forms, a neutral approval-stamp shape with no text, a glass hourglass, and a discreet telephone handset",
    "/guides/glp-1-program-total-cost-comparison/": "a long accordion receipt ribbon crossing calendar blocks, an insulated treatment parcel, and a single unbranded container with no calculator",
    "/guides/healthrx-vs-agelessrx/": "two distinct unbranded care kits staged as separate service paths: a teal home-testing case with a sealed specimen tube opposite a navy telehealth parcel with an amber bottle, divided by a glass route fork",
    "/guides/how-to-get-ozempic-online/": "a four-stage telehealth path built from a phone-shaped glass intake panel, a clinician-review lens, an unbranded pen-shaped cold-chain device, and an insulated delivery parcel connected by teal wayfinding beads",
    "/guides/how-to-get-zepbound-online/": "an overhead verification journey with a sealed prescription envelope, an unbranded dual-dose pen-shaped case, a pharmacy inspection loupe, and a cold-pack shipping tray arranged as four checkpoints",
    "/guides/insulin-resistance-evidence-overview/": "a glucose-sensor disc beside a translucent blood-vessel channel, paired glucose and insulin bead curves, a blood-orange wedge, and a blank laboratory trend strip",
    "/guides/lilly-patient-assistance-vs-savings/": "two clearly separated access paths: a document folio under a protective glass arch opposite a wallet card with clipped coupon tabs, joined only at an unbranded treatment parcel",
    "/guides/medicare-glp-1-bridge-eligibility/": "a stepping-stone bridge made from blank eligibility cards spanning a narrow glass channel between a Medicare-style neutral card and an unbranded cold-chain parcel",
    "/guides/metabolic-health-evidence-overview/": "an interconnected evidence landscape of a glucose-sensor disc, measuring tape loop, blood-orange wedge, and four mineral biomarkers orbiting a central glass metabolism dial",
    "/guides/metabolic-syndrome-evidence-guide/": "five distinct risk markers arranged around a waist-measurement ring: a pressure gauge, glucose bead curve, lipid droplets, blood-orange wedge, and blank clinical evidence tile",
    "/guides/minoxidil-evidence-and-options/": "a scalp cross-section glass model with visible hair follicles, an unbranded dropper, a small foam-dispensing silhouette, and a calibrated treatment timeline made of blank monthly markers",
    "/guides/mounjaro-cost-without-insurance/": "an unbranded cold-chain pen-shaped case beside three descending self-pay pathway blocks, a transparent total-cost ruler, and a wallet with restrained payment discs, with no calculator",
    "/guides/mounjaro-coupon/": "a perforated blank savings-card strip passing through an eligibility gate, beside one unbranded pen-shaped cold-chain case and a locked neutral insurance card",
    "/guides/mounjaro-side-effects-evidence-guide/": "an anatomical glass stomach silhouette beside a hydration vessel, a portioned meal plate, a blank symptom timeline, and an unbranded pen-shaped device resting in the background",
    "/guides/mounjaro-vs-ozempic-label-and-cost/": "two unbranded pen-shaped devices with visibly different proportions on separate label-evidence plinths, divided by a dose ladder and a long transparent cost ruler",
    "/guides/mounjaro-vs-zepbound-label-and-cost/": "two related but distinct unbranded pen-shaped cases branching from one molecule model toward separate blank indication folders, with a shared cost scale beneath",
    "/guides/novo-nordisk-patient-assistance-vs-savings/": "a formal application envelope and eligibility key on one side, a perforated savings-card ribbon and wallet on the other, with an unbranded cold-chain parcel centered beyond both paths",
    "/guides/online-ed-treatment-verification-checklist/": "a discreet sealed tablet blister, a water glass, a pharmacy credential token under a magnifying lens, and a phone-shaped telehealth confirmation panel inside a private navy medicine case",
    "/guides/online-hair-loss-treatment-verification/": "a scalp-follicle glass model, a fine comb, an unbranded dropper and tablet blister, plus a tamper-seal inspection card under a small loupe",
    "/guides/online-trt-clinic-verification/": "a sealed laboratory requisition kit with two blood collection tubes, an unbranded testosterone vial silhouette, a capped administration device, and a clinic identity token under inspection light",
    "/guides/oral-glp-1-insurance-coverage/": "an unbranded tablet blister and amber pill bottle crossing a layered formulary-book gate, with an insurance card protected by a translucent coverage shield",
    "/guides/ozempic-cost-without-insurance/": "an unbranded pen-shaped cold-chain case beside a descending self-pay pathway made from three month blocks, an accordion receipt ribbon, and an open wallet with no calculator",
    "/guides/ozempic-side-effects-evidence-guide/": "an anatomical glass stomach silhouette, a hydration glass, a small portioned meal plate, and a blank symptom-frequency timeline beside an unbranded pen-shaped device",
    "/guides/ozempic-vs-wegovy-label-and-cost/": "two semaglutide treatment paths with differently shaped unbranded pen cases on separate label folders, divided by a dose staircase and a single transparent cost ruler",
    "/guides/peptide-clinic-verification-checklist/": "three sealed research vials in a chain-of-custody rack, a blank certificate-of-analysis folio, a sterile-process grid, and a tamper seal under a magnifying lens",
    "/guides/semaglutide-online-safety-verification/": "an unbranded semaglutide pen-shaped device in a cold-pack tray, paired with a pharmacy credential token, tamper seal, and calibrated dosing inspection gauge",
    "/guides/semaglutide-vs-tirzepatide-label-evidence/": "two visibly different molecular glass models and two unbranded pen-shaped devices, each anchored to its own blank indication folder and dose ladder",
    "/guides/tirzepatide-cost/": "an unbranded dual-dose pen-shaped case moving across a dose-escalation staircase and four calendar blocks, with a long receipt ribbon showing cumulative cost without a calculator",
    "/guides/tirzepatide-online-verification-checklist/": "a four-checkpoint telehealth path with phone-shaped intake panel, clinician-review lens, pharmacy seal, and an unbranded pen-shaped device inside a cold-chain parcel",
    "/guides/trt-cost-and-insurance-questions/": "two testosterone care cost lanes: a laboratory panel and treatment vial beneath an insurance shield opposite a gel pump, wallet, and month-by-month self-pay blocks",
    "/guides/trt-evidence-overview/": "a testosterone molecule model beside paired blood collection tubes, an unbranded treatment vial, and four blank evidence-domain tiles arranged around a laboratory centrifuge rotor",
    "/guides/verify-online-glp-1-program-product-status/": "a product-status decision tree branching toward an unbranded branded-style pen case and an unbranded compounded vial, each with distinct blank regulatory evidence folders and pharmacy seals",
    "/guides/wegovy-pills-oral-semaglutide-cost/": "an unbranded oral-semaglutide tablet blister and amber bottle beside a dose ladder, calendar blocks, and a transparent monthly cost ribbon, with no calculator",
    "/guides/wegovy-side-effects-evidence-guide/": "a glass digestive-tract model surrounded by hydration, meal-timing, and symptom-log props, with an unbranded pen-shaped device held in the distant background",
    "/guides/zepbound-coupon/": "a perforated blank savings-card ribbon threading through a qualification gate, beside one unbranded dual-dose pen-shaped case and a locked insurance token",
    "/guides/zepbound-insurance-coverage/": "an unbranded pen-shaped cold-chain case approaching layered formulary gates beneath a translucent insurance shield, with distinct covered and uncovered path markers",
    "/guides/zepbound-side-effects-evidence-guide/": "a glass digestive-system silhouette paired with hydration, meal-size, and symptom-duration markers, with an unbranded dual-dose pen-shaped device in the background",
    "/guides/zepbound-wegovy-cost-without-insurance/": "two different unbranded pen-shaped cold-chain cases following separate self-pay staircases across six calendar blocks, converging at one transparent total-cost ruler",
    "/guides/zepbound-wegovy-savings-card-terms/": "two distinct perforated blank savings cards under separate eligibility locks, paired with unbranded pen-shaped cases and a calendar cutoff gate",
}


def scene_for(route: str) -> str:
    key = route.lower()
    if key in ROUTE_SCENE_OVERRIDES:
        return ROUTE_SCENE_OVERRIDES[key]
    if any(token in key for token in ("counterfeit", "verification", "verify", "pharmacy")):
        return "a tamper-evident unbranded vial, a blank inspection checklist, a cold-pack card, and a magnifying lens"
    if any(token in key for token in ("cost", "coupon", "fees", "insurance", "coverage", "savings", "hsa", "fsa", "reimbursement", "cheapest", "price")):
        return "a clean calculator, a blank invoice, an unbranded payment card, and restrained coin-like discs"
    if any(token in key for token in ("side-effects", "evidence", "regulatory", "status")):
        return "a blank clinical evidence packet, a molecular model, a caution tab, and an unbranded amber vial"
    if any(token in key for token in (" vs ", "-vs-", "alternatives", "comparison")):
        return "two deliberately different unbranded treatment still lifes separated by blank evidence cards and a neutral comparison ruler"
    if any(token in key for token in ("finasteride", "minoxidil", "hair-loss")):
        return "a comb, an unbranded amber dropper, a blank dermatology note, and a soft strand-detail macro element"
    if any(token in key for token in ("sildenafil", "tadalafil", "viagra", "cialis", "erectile")):
        return "an unbranded tablet blister, a discreet blank clinical note, a glass of water, and a dark mineral stone surface"
    if any(token in key for token in ("testosterone", "trt")):
        return "an unbranded laboratory vial, a blank lab requisition, a capped injection-device silhouette, and a brushed aluminum tray"
    if any(token in key for token in ("peptide", "bpc", "cjc", "ipamorelin")):
        return "an unbranded research vial, a molecular model, a blank evidence card, and a restrained warning marker"
    if any(token in key for token in ("insulin", "metabolic", "glucose", "cgm")):
        return "a glucose-sensor disc, a blood-orange slice, a blank lab chart, and a mineral-glass measurement tile"
    if any(token in key for token in ("oral", "pill")):
        return "an unbranded tablet blister, a neutral amber bottle, a blank dosing card, and a glass evidence tile"
    if any(token in key for token in ("shortage", "availability")):
        return "a partly empty pharmacy supply tray, an insulated parcel, an unbranded vial silhouette, and a blank availability card"
    if any(token in key for token in ("cancellation", "subscription")):
        return "a blank contract page, a calendar tile, an open parcel, and a clearly separated cancel-path marker without text"
    if any(token in key for token in ("online", "prescription", "intake", "program", "provider")):
        return "a phone-shaped glass panel, a blank intake checklist, an insulated parcel, and an unbranded treatment container"
    return "an unbranded treatment container, a blank research note, a molecular glass object, and one topic-specific evidence prop"


def composition_for(route: str) -> str:
    digest = int(hashlib.sha256(route.encode()).hexdigest()[:8], 16)
    lenses = ["50mm eye-level editorial view", "85mm close still-life view", "35mm three-quarter desk view", "70mm low-angle evidence-table view", "top-down 45mm evidence-layout view", "100mm macro-detail view", "40mm side-profile studio view", "60mm shallow-depth split view"]
    surfaces = ["deep navy stone", "mineral teal glass", "warm gray laboratory paper", "brushed dark aluminum", "smoked translucent acrylic", "matte pale mineral composite"]
    lighting = ["soft teal rim light with warm amber practical fill", "cool window light with a restrained amber edge", "controlled overhead softbox with a faint aurora reflection", "directional side light with deep navy falloff", "broad diffused skylight with one warm reflection", "low raking light with clean controlled shadows"]
    arrangements = ["a diagonal visual flow", "three distinct depth planes", "a balanced split composition", "an asymmetric editorial cluster", "a restrained radial arrangement", "a single foreground hero with supporting evidence behind it"]
    subject_side = ["right", "left"]
    return f"{lenses[digest % len(lenses)]} on {surfaces[(digest // 7) % len(surfaces)]}, {lighting[(digest // 13) % len(lighting)]}, {arrangements[(digest // 17) % len(arrangements)]}, dominant objects weighted to the {subject_side[(digest // 23) % 2]} with generous clean negative space on the opposite side"


def prompt_for(record: dict) -> tuple[str, str]:
    route = record["route"]
    title = slug_title(route)
    subject = f"Editorial evidence still life for {title}: {scene_for(route)}."
    prompt = (
        f"Create a premium, photorealistic 16:9 editorial image for an independent healthcare comparison article titled {title}. "
        f"Dominant subject: {scene_for(route)}. Composition: {composition_for(route)}. "
        "The scene must be unmistakably specific to this article topic while remaining medically neutral and non-promotional. "
        "Palette: deep navy, mineral teal, restrained warm amber, soft atmospheric aurora reflections. "
        "Physically plausible glass, paper, aluminum, and clinical materials; premium evidence-desk art direction; no human treatment outcome. "
        "All objects must be unbranded and all labels or screens must be blank and illegible. One coherent photograph, not a UI screenshot. "
        "Negative prompt: visible words, letters, numbers, labels, manufacturer or provider logos, copied packaging, invented branded packaging, prices, ratings, testimonials, before-and-after imagery, clinical outcome claims, fake patient evidence, watermarks, malformed hands, implausible devices, floating pills, syringe spectacle, generic wellness filler, competitor-identifying visual elements."
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
            output = OUTPUT_DIR / f"{stem}{extension}"
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


def generate_one(record: dict, state: dict) -> dict:
    route = record["route"]
    stem = record["stem"]
    subject, prompt = prompt_for(record)
    previous = state["records"].get(route) or {}
    previous_path = Path(previous.get("output_path", "")) if previous.get("output_path") else None
    if previous.get("status") == "PASS" and previous_path and previous_path.exists():
        width, height, image_format = dimensions(previous_path)
        if width >= 2_400 and len(prompt) > 300:
            return previous

    command = [
        shutil.which("higgsfield") or "higgsfield",
        "generate",
        "create",
        MODEL,
        "--prompt",
        prompt,
        "--aspect_ratio",
        "16:9",
        "--quality",
        "high",
        "--resolution",
        "4k",
        "--wait",
        "--wait-timeout",
        "30m",
        "--json",
    ]
    started = time.time()
    result = subprocess.run(command, text=True, capture_output=True, timeout=2_100, check=False)
    raw_path = RAW_DIR / f"{stem}.json"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_record = {
        "route": route,
        "subject": subject,
        "prompt": prompt,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    atomic_json(raw_path, raw_record)
    record_result = {
        "route": route,
        "stem": stem,
        "subject": subject,
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "raw_receipt": str(raw_path),
        "elapsed_seconds": round(time.time() - started, 2),
        "status": "FAIL",
    }
    try:
        if result.returncode != 0:
            raise RuntimeError(f"higgsfield exited {result.returncode}: {result.stderr[-500:]}")
        payload = json.loads(result.stdout)
        urls = recursive_urls(payload)
        output, content_type = download_image(urls, stem)
        width, height, image_format = dimensions(output)
        if width < 2_400 or height < 1_200:
            raise RuntimeError(f"generated master below threshold: {width}x{height}")
        record_result.update({
            "status": "PASS",
            "output_path": str(output),
            "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "output_bytes": output.stat().st_size,
            "width": width,
            "height": height,
            "format": image_format,
            "content_type": content_type,
            "result_url_count": len(urls),
        })
    except Exception as exc:  # noqa: BLE001
        record_result["error"] = f"{type(exc).__name__}: {exc}"
    with STATE_LOCK:
        state["records"][route] = record_result
        state["updated_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_json(STATE_PATH, state)
    return record_result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="generate at most N pending routes; 0 means all")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--force-route", action="append", default=[], help="regenerate this exact route even when its prior record passed")
    parser.add_argument("--force-routes-file", type=Path, help="newline-delimited exact routes to regenerate")
    args = parser.parse_args()
    if not 1 <= args.workers <= 4:
        raise SystemExit("workers must be between 1 and 4")
    manifest = json.loads(DERIVATIVE_MANIFEST.read_text())
    records = manifest["inventory"]["article"]["records"]
    state = load_state()
    forced = set(args.force_route)
    if args.force_routes_file:
        forced.update(line.strip() for line in args.force_routes_file.read_text().splitlines() if line.strip())
    valid_routes = {record["route"] for record in records}
    unknown_forced = sorted(forced - valid_routes)
    if unknown_forced:
        raise SystemExit(f"unknown forced routes: {unknown_forced}")
    for route in forced:
        state["records"].pop(route, None)
    if forced:
        atomic_json(STATE_PATH, state)
    pending = []
    for record in records:
        prior = state["records"].get(record["route"]) or {}
        output = Path(prior.get("output_path", "")) if prior.get("output_path") else None
        if prior.get("status") != "PASS" or not output or not output.exists():
            pending.append(record)
    if args.limit:
        pending = pending[: args.limit]
    if not pending:
        print(json.dumps({"status": "PASS", "generated": 0, "remaining": 0, "state": str(STATE_PATH)}))
        return 0
    outcomes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(generate_one, record, state) for record in pending]
        for future in concurrent.futures.as_completed(futures):
            outcome = future.result()
            outcomes.append(outcome)
            print(json.dumps({"route": outcome["route"], "status": outcome["status"], "elapsed_seconds": outcome.get("elapsed_seconds")}), flush=True)
    state = load_state()
    passed = sum(1 for value in state["records"].values() if value.get("status") == "PASS")
    remaining = len(records) - passed
    summary = {"status": "PASS" if all(value["status"] == "PASS" for value in outcomes) else "PARTIAL", "generated_this_run": len(outcomes), "passed_total": passed, "remaining": remaining, "state": str(STATE_PATH)}
    print(json.dumps(summary), flush=True)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
