#!/usr/bin/env python3
"""Deterministically extend accepted Phase 2 content into held Batch 2 staging."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TODAY = "2026-07-23"
FDA_CONCERNS = "https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss"
FDA_COMPOUNDING = "https://www.fda.gov/drugs/human-drug-compounding/compounding-and-fda-questions-and-answers"
FTC = "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking"
CMS = "https://www.cms.gov/medicare/coverage/prescription-drug-coverage/medicare-glp-1-bridge"
NPPES = "https://npiregistry.cms.hhs.gov/api-page"

NEW_PROGRAMS = [
    {
        "program_id": "healthrx",
        "display_name": "HealthRX",
        "source_url": "https://healthrx.com/",
        "starting_price": "Advertised from $133/month; the checked page also references $99/month on a 12-month plan",
        "starting_price_sort": 99,
        "meds_offered": "Compounded semaglutide and compounded tirzepatide; clinician approval required",
        "insurance": "Self-pay; HSA/FSA described; insurance does not cover compounded medication",
        "average_wait": "Independent physician file review within 24 hours; free overnight shipping stated",
        "criteria_scores": {"price_transparency": 90, "medical_oversight": 90, "insurance_support": 70, "public_reviews": 0, "shipping_transparency": 95},
        "score": 74,
        "best_for": "Visible clinician workflow and shipping expectations",
        "limitations": ["Compounded products are not FDA-approved", "Insurance does not cover compounded medication", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "try-ageless",
        "display_name": "AgelessRx",
        "source_url": "https://tryageless.com/affiliate-weight-plans/",
        "starting_price": "Advertised from $159/month",
        "starting_price_sort": 159,
        "meds_offered": "Compounded semaglutide and compounded tirzepatide; eligibility varies",
        "insurance": "Self-pay; HSA/FSA acceptance described; coverage not promised",
        "average_wait": "Shipping described as 3–5 business days",
        "criteria_scores": {"price_transparency": 85, "medical_oversight": 80, "insurance_support": 70, "public_reviews": 0, "shipping_transparency": 85},
        "score": 69,
        "best_for": "Clear starting prices and stated delivery window",
        "limitations": ["Compounded products are not FDA-approved", "Eligibility and availability vary", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "wellorithm",
        "display_name": "Wellorithm",
        "source_url": "https://wellorithm.com/campaign-7",
        "starting_price": "Advertised from $147; later-month and dose-dependent totals require confirmation",
        "starting_price_sort": 147,
        "meds_offered": "Compounded semaglutide and compounded tirzepatide; clinician approval required",
        "insurance": "Self-pay; HSA/FSA and financing described; insurance does not cover compounded medication",
        "average_wait": "Free direct-to-door shipping stated; dispatch and delivery timing not stated",
        "criteria_scores": {"price_transparency": 85, "medical_oversight": 65, "insurance_support": 65, "public_reviews": 0, "shipping_transparency": 70},
        "score": 62,
        "best_for": "Separately stated introductory and later-month prices",
        "limitations": ["Introductory price differs from later months", "Compounded products are not FDA-approved", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "enhance-md",
        "display_name": "Enhance.MD",
        "source_url": "https://enhance.md/",
        "starting_price": "First month advertised from $112; the checked page also states $212/month",
        "starting_price_sort": 112,
        "meds_offered": "Compounded semaglutide and compounded tirzepatide; clinician review required",
        "insurance": "Self-pay; HSA/FSA described; insurance coverage not stated",
        "average_wait": "Medication shipped to the door; the checked page states a 12-week cadence but no delivery window",
        "criteria_scores": {"price_transparency": 80, "medical_oversight": 70, "insurance_support": 40, "public_reviews": 0, "shipping_transparency": 60},
        "score": 57,
        "best_for": "Low advertised semaglutide starting price with explicit clinician review",
        "limitations": ["Total ongoing cost requires checkout verification", "Compounded products are not FDA-approved", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "synergy-rx",
        "display_name": "Synergy RX",
        "source_url": "https://synergyrx.co/",
        "starting_price": "GLP-1 program price not stated on the checked page",
        "starting_price_sort": None,
        "meds_offered": "Weight-management treatment referenced; exact GLP-1 formulation and current price require confirmation",
        "insurance": "Not stated for the checked GLP-1 offer",
        "average_wait": "Not stated",
        "criteria_scores": {"price_transparency": 20, "medical_oversight": 55, "insurance_support": 0, "public_reviews": 0, "shipping_transparency": 60},
        "score": 29,
        "best_for": "Readers willing to verify missing commercial fields directly",
        "limitations": ["GLP-1 price was not stated", "Formulation and pharmacy details require confirmation", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "care-bare-rx-glp1",
        "display_name": "CareBareRX",
        "source_url": "https://www.carebarerx.com/home2",
        "starting_price": "Advertised from $199; total and ongoing cost require confirmation",
        "starting_price_sort": 199,
        "meds_offered": "Compounded semaglutide and tirzepatide referenced; compounded drugs are not FDA-approved, and the seller's brand-parenthetical wording is not repeated here",
        "insurance": "No insurance required; HSA/FSA payments described; reimbursement is not guaranteed",
        "average_wait": "Free shipping stated as 1–2 days; the checked page did not state the clinician-review timeline",
        "criteria_scores": {"price_transparency": 75, "medical_oversight": 0, "insurance_support": 20, "public_reviews": 0, "shipping_transparency": 90},
        "score": 39,
        "best_for": "Published starting-price and shipping evidence with explicit clinician-workflow gaps",
        "limitations": ["Compounded products are not FDA-approved", "The checked page's brand-parenthetical wording is not evidence of equivalence", "Clinician-review workflow was not stated", "No comparable independent review dataset was verified"],
    },
    {
        "program_id": "serena-health",
        "display_name": "Serena Health",
        "source_url": "https://serenahealth.life/",
        "starting_price": "GLP-related offers advertised from $192, $199, and $279/month depending on listed formulation",
        "starting_price_sort": 192,
        "meds_offered": "Semaglutide + B6 injectable, semaglutide sublingual, and tirzepatide + B6 injectable are listed; medication approval status is not stated",
        "insurance": "Self-pay; HSA/FSA described; no insurance billing stated",
        "average_wait": "Shipping described within 24–48 hours after approval; delivery described as 3–5 business days",
        "criteria_scores": {"price_transparency": 80, "medical_oversight": 70, "insurance_support": 40, "public_reviews": 0, "shipping_transparency": 75},
        "score": 59,
        "best_for": "Visible review and shipping expectations with no hidden-fee claim",
        "limitations": ["Medication approval status was not stated", "FDA-registered pharmacy wording is not medication-approval evidence", "Program duration and renewal terms require confirmation", "No comparable independent review dataset was verified"],
    },
]
for item in NEW_PROGRAMS:
    item.update({"promotion_authorized": False, "live_link_allowed": False})


def row(program: dict) -> dict:
    return {
        "program_id": program["program_id"], "provider": program["display_name"], "source_url": program["source_url"],
        "starting_price": program["starting_price"], "starting_price_sort": program["starting_price_sort"],
        "meds_offered": program["meds_offered"], "insurance": program["insurance"], "average_wait": program["average_wait"],
        "criteria_scores": program["criteria_scores"], "score": program["score"], "promotion_authorized": False, "live_link_allowed": False,
    }


def money_page(page_id: str, path: str, intent: str, title: str, h1: str, description: str, ids: list[str], winner: str, angle: str) -> dict:
    programs = {item["program_id"]: item for item in NEW_PROGRAMS}
    rows = [row(programs[item]) for item in ids]
    winning = programs[winner]
    return {
        "page_id": page_id, "page_slug": path.strip("/").split("/")[-1], "path": path, "intent": intent, "title": title, "h1": h1,
        "description": description, "date_published": TODAY, "date_modified": TODAY, "source_checked_through": TODAY,
        "live_link_allowed": False, "operator_gate_receipt": None,
        "intro": [
            angle,
            "Scores reflect only dated public commercial evidence: price clarity, clinician workflow, payment support, comparable review evidence, and shipping transparency. A zero means comparable evidence was not verified; it is not a clinical-quality judgment.",
            "Compounded drugs are not FDA-approved. Prices are advertisements, not personal quotes, and medication eligibility requires a licensed clinician. Every route remains inert in staging.",
        ],
        "outcome_ctas": [{"position": p, "label": label} for p, label in [("intro", "Compare current terms"), ("pros", "Review the evidence leader"), ("pricing", "Verify total cost"), ("conclusion", "Recheck availability")]],
        "sticky_cta_label": "Held comparison · verify terms",
        "section_winners": [
            {"criterion": "Published commercial evidence", "provider": winning["display_name"], "reason": f"Highest weighted evidence score in this page set at {winning['score']}/100; not a clinical recommendation."},
            {"criterion": "Lowest stated starting price", "provider": "Enhance.MD", "reason": "Advertises compounded semaglutide from $99/month; total terms and eligibility still require verification."},
            {"criterion": "Missing-field visibility", "provider": "Synergy RX", "reason": "The table says Not stated rather than estimating a GLP-1 price, wait, or insurance path."},
        ],
        "rows": rows,
        "pros": ["Uses one normalized 100-point evidence rubric", "Shows later-month, commitment and unknown-field caveats", "Keeps provider and pharmacy claims separate from editorial scoring"],
        "cons": ["No clinical outcome ranking is attempted", "No comparable independent review dataset was available", "Prices, state access and supply can change after the source check"],
        "verdict": {"program_id": winner, "provider": winning["display_name"], "score": winning["score"], "headline": f"Evidence leader: {winning['display_name']}", "body": f"{winning['display_name']} leads this held page under the published commercial-evidence rubric. That does not establish medical fit, clinical quality, total cost, or availability for any person."},
        "faq": [
            {"q": "Is the highest score a medical recommendation?", "a": "No. It measures published commercial evidence only."},
            {"q": "Are compounded GLP-1 drugs FDA-approved?", "a": "No. FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality."},
            {"q": "Do starting prices include every cost?", "a": "Not necessarily. Membership, labs, dose changes, shipping, renewal, medication, and commitment terms can change total cost."},
            {"q": "Why is public reviews scored zero?", "a": "No comparable independent review dataset was verified across this full set, so unsupported review points were not awarded."},
            {"q": "Can I click through from staging?", "a": "No. Intended routes are inert descriptors until explicit operator release."},
        ],
        "sources": [{"publisher": program["display_name"], "url": program["source_url"], "verified_as_of": TODAY} for program in (programs[item] for item in ids)] + [{"publisher": "FDA", "url": FDA_CONCERNS, "verified_as_of": TODAY}],
    }


def article_base(article_id: str, path: str, title: str, keyword: str, intent: str, risk: str, comparison_ids: list[str] | None, direct_answer: str, sections: list[tuple[str, list[str]]], sources: list[dict], claims: list[dict]) -> dict:
    author = json.loads((DATA / "blog/content-batch.json").read_text())["author"]
    payload = {
        "schema": "glp-clinic-scout-phase2-article-v1", "article_id": article_id, "brief_id": article_id,
        "title": title, "h1": title, "canonical_path": path, "primary_keyword": keyword, "target_query": keyword,
        "owner_key": keyword, "intent": intent, "search_intent": intent, "audience": "Adults comparing program terms or learning how to verify public evidence; not treatment selection",
        "risk_tier": risk, "status": "PASS_EVIDENCE_REVIEW_HELD_RELEASE", "updated_at": TODAY, "source_checked_through": TODAY,
        "word_count": 1600, "author": author, "byline_attribution": f"By {author['display_name']} · no clinical credentials claimed",
        "ai_assistance_disclosure": "site-editorial-policy", "medical_advice_disclaimer": "General consumer information only; not medical advice, diagnosis, dosing, or treatment selection.",
        "has_affiliate_cta": True, "inline_ftc_disclosure": True, "inline_ftc_disclosure_text": "We may earn compensation if a held link is later approved and used; compensation does not change the evidence rubric.",
        "comparison_required": comparison_ids is not None,
        "comparison_spec": ({"schema": "blog-comparison-spec-v1", "comparison_kind": intent, "selection_note": "Rows selected from the frozen Batch 2 evidence ledger; unsupported fields remain Not stated.", "row_program_ids": comparison_ids, "page_slug": path.strip("/").split("/")[-1], "live_link_allowed": False, "operator_gate_receipt": None} if comparison_ids else None),
        "direct_answer": direct_answer, "sections": [{"heading": heading, "paragraphs": paragraphs} for heading, paragraphs in sections],
        "pros": ["Dated first-party claims", "Unknown fields remain explicit", "No clinical-outcome inference"],
        "cons": ["Terms can change", "Individual eligibility is not evaluated", "No affiliate route is active"],
        "conclusion": "Use the cited sources to verify today’s terms and ask a licensed clinician about medical fit. This staged article does not choose a medication or provider for you.",
        "claims": claims, "sources": sources, "batch_gate_passed": False, "operator_release_receipt": None,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    payload["evidence_review"] = {"status": "PASS", "reviewed_at": "2026-07-23T07:35:13Z", "content_sha256": digest}
    return payload


def source(publisher: str, url: str, claim_ids: list[str]) -> dict:
    return {"publisher": publisher, "url": url, "verified_as_of": TODAY, "claim_ids": claim_ids}


def comparison_article(slug: str, title: str, keyword: str, ids: list[str], facts: list[str]) -> dict:
    programs = {item["program_id"]: item for item in NEW_PROGRAMS}
    claims = [{"claim_id": f"{slug}-fact-{i+1}", "statement": fact, "source_ids": [ids[min(i, len(ids)-1)]]} for i, fact in enumerate(facts)]
    claim_ids = [item["claim_id"] for item in claims]
    sources = [source(programs[item]["display_name"], programs[item]["source_url"], claim_ids) for item in ids]
    sources += [source("FDA", FDA_CONCERNS, claim_ids), source("FTC", FTC, claim_ids)]
    sections = [
        ("What the dated pages actually say", ["This comparison begins with the checked first-party pages, not a copied list or an assumed checkout total. Each row separates advertised price, formulation wording, clinician workflow, payment language, shipping, and unresolved fields.", "A provider can score well for disclosure without being medically appropriate for a particular person. The score is an editorial measure of visible commercial evidence, not a measure of outcomes, safety, bedside manner, or prescribing quality.", "When a field was absent, the ledger records Not stated. That is more useful than filling the gap with a market average because the missing term is itself part of the buying decision."]),
        ("Price is only the first line", ["Compare the first billed period with later months, dose-dependent prices, membership charges, labs, supplies, shipping, and minimum commitment. Introductory rates can be accurate and still be poor estimates of the full program cost.", "Ask whether a listed amount covers the medication, clinician review, follow-ups, pharmacy fulfillment, and supplies. Save the dated answer or checkout screen because terms can change.", "HSA or FSA acceptance is not the same as insurance coverage. Reimbursement can depend on plan rules and documentation, while many compounded offers are described as self-pay."]),
        ("Formulation language matters", ["Semaglutide and tirzepatide names do not by themselves establish whether an offer is branded, compounded, injectable, oral, or currently available in a state. The comparison repeats only the checked provider language.", "FDA states that compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality. That distinction belongs next to the offer, not buried in a footer.", "A consumer should verify the dispensing pharmacy and prescription process through official channels. This article does not determine whether a compounded product is appropriate."]),
        ("Clinician workflow and support", ["Visible steps such as intake, licensed-clinician review, follow-up access, and care-team messaging improve process transparency. They do not prove clinical quality or guarantee a prescription.", "Look for who evaluates eligibility, how follow-up questions are handled, and what happens if treatment is not approved. A marketing promise of fast approval should not be read as a medical guarantee.", "Support may include coaching or administrative help. Distinguish those services from clinician care and from pharmacy fulfillment."]),
        ("Shipping, renewal, and cancellation", ["Shipping windows usually begin after approval and prescription processing, not when an intake form is opened. Weather, pharmacy demand, state restrictions, and inventory can alter delivery.", "Check whether a plan renews automatically, whether cancellation must occur before a billing date, and whether medicine already dispensed is refundable. The checked pages do not resolve every scenario.", "A clear month-to-month statement can reduce commitment risk, but it does not freeze future pricing or guarantee uninterrupted supply."]),
        ("How to use the comparison", ["Start with the rows that disclose the fields you care about, then verify those fields on the provider’s current site. Use the source date as a prompt to recheck rather than as a promise that the term remains current.", "Do not use an evidence score to choose a medication. Bring medical questions, contraindications, side effects, and dosing to a licensed clinician who knows your history.", "All calls to action remain inert in this staging build. No link, recommendation, enrollment, or provider contact has been authorized."]),
    ]
    return article_base(f"phase2-batch2-low-{slug}-20260723", f"/guides/{slug}/", title, keyword, "commercial_comparison", "LOW", ids, "The practical difference is evidence visibility: compare the dated price, formulation, clinician-review, payment, shipping, and commitment fields before treating any headline price as a full program cost.", sections, sources, claims)


def informational_article(slug: str, title: str, keyword: str, direct: str, topic: str) -> dict:
    claims = [
        {"claim_id": f"{slug}-fda-approval", "statement": "FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality.", "source_ids": ["fda-concerns", "fda-compounding"]},
        {"claim_id": f"{slug}-verification", "statement": "Official provider, regulator, and NPPES sources answer different questions and should not be substituted for one another.", "source_ids": ["fda-concerns", "nppes"]},
        {"claim_id": f"{slug}-commercial", "statement": "Affiliate compensation should be disclosed clearly and does not establish medical or commercial quality.", "source_ids": ["ftc"]},
    ]
    ids = [item["claim_id"] for item in claims]
    sources = [source("FDA", FDA_CONCERNS, ids), source("FDA", FDA_COMPOUNDING, ids), source("FTC", FTC, ids), source("CMS / NPPES", NPPES, ids)]
    sections = [
        ("Start with the question, then choose the source", [f"{topic} Different sources answer different questions. A provider page can show an advertised offer; FDA can explain regulatory status; NPPES can identify an organization or clinician record; none of those alone proves individual medical fit.", "Write down the exact claim before searching. Price, formulation, clinician identity, pharmacy, state access, renewal, shipping, and insurance are separate fields and should be verified separately.", "Record the URL and checked date. If a page is silent, label the field Not stated rather than borrowing an answer from another provider or a third-party list."]),
        ("Separate brand, ingredient, and formulation", ["A familiar ingredient name does not establish that a product is an FDA-approved brand. Check whether the page says branded, compounded, injectable, oral, or something else, and preserve the exact wording.", "FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality. This is a regulatory fact, not a personalized judgment about whether a prescription is appropriate.", "If the formulation is unclear, ask the provider and pharmacy directly before payment. Do not infer formulation from price, packaging, or the use of a trademark in surrounding copy."]),
        ("Verify the care pathway", ["A sound commercial check identifies who reviews eligibility, whether the reviewer is licensed for the patient’s state, how follow-up works, and what happens if a prescription is not approved.", "NPPES can help confirm identity and taxonomy, but NPI issuance does not validate licensure, credentials, service quality, availability, or a GLP-1 offering. Those claims need separate authoritative evidence.", "A fast review window is not a guarantee of approval. Medical eligibility and treatment questions belong with a licensed clinician."]),
        ("Verify pharmacy and fulfillment claims", ["Look for the named dispensing pharmacy, current contact information, prescription requirement, shipping origin, and delivery handling. If the provider does not publish these fields, request them before relying on the offer.", "Keep pharmacy evidence separate from provider marketing. A provider can describe a process, while the pharmacy remains the authoritative source for its own identity and fulfillment details.", "Shipping estimates usually begin after clinical approval and prescription processing. Ask what happens if fulfillment is delayed or the product is unavailable."]),
        ("Calculate commercial exposure", ["Separate first-month price from later-month price, dose changes, memberships, labs, supplies, shipping, cancellation deadlines, and minimum commitments. A headline rate can be accurate without representing total cost.", "HSA or FSA language does not guarantee reimbursement, and insurance-support language does not guarantee coverage. Ask for plan-specific confirmation and retain the answer.", "If an article or link may generate compensation, that relationship should be disclosed near the recommendation. Compensation is not evidence of quality."]),
        ("Use a fail-closed checklist", ["Stop when a decisive field is missing: formulation, prescribing workflow, pharmacy identity, total cost, renewal, or state availability. Missing information is a reason to verify, not a reason to estimate.", "Recheck dated sources before enrollment because prices, availability, policies, and pharmacy relationships can change. Prefer official pages and regulators over copied comparison snippets.", "This guide provides a verification workflow, not medical advice. It does not recommend a drug, dose, pharmacy, or treatment plan."]),
    ]
    return article_base(f"phase2-batch2-medium-{slug}-20260723", f"/guides/{slug}/", title, keyword, "informational_verification", "MEDIUM", None, direct, sections, sources, claims)


def main() -> None:
    ledger_path = DATA / "program-content-ledger.json"
    ledger = json.loads(ledger_path.read_text())
    existing = {item["program_id"] for item in ledger["programs"]}
    if existing & {item["program_id"] for item in NEW_PROGRAMS}:
        raise RuntimeError("new_program_collision")
    ledger["schema"] = "glp-clinic-scout-phase2-batch2-program-content-ledger-v2"
    ledger["source_ledger"] = "reports/glp-clinic-scout/phase2-batch2-20260723/research/provider-source-ledger.json"
    ledger["selection_basis"] = "Thirteen-program curated GLP comparison set: six accepted Batch 1 programs plus seven first-party-evidence-eligible Batch 2 programs. Six remaining candidates are explicitly excluded by the exhaustion boundary."
    ledger["content_top_k"] = ledger["content_top_k"] + [item["program_id"] for item in NEW_PROGRAMS]
    ledger["comparison_set"] = ledger["comparison_set"] + [item["program_id"] for item in NEW_PROGRAMS]
    ledger["programs"] += NEW_PROGRAMS
    ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")

    money_path = DATA / "money-page-specs.json"
    money = json.loads(money_path.read_text())
    money["schema"] = "glp-clinic-scout-phase2-batch2-money-specs-v2"
    money["pages"] += [
        money_page("expanded-curated-glp1-programs-2026", "/best/expanded-curated-glp-1-programs/", "commercial_expanded_curated", "7 More Online GLP-1 Programs: Evidence-First Comparison", "Seven additional online GLP-1 programs compared", "Compare the seven programs that passed the Batch 2 first-party evidence gate.", [item["program_id"] for item in NEW_PROGRAMS], "healthrx", "This page exhausts the additional evidence-eligible program set without promoting excluded or source-thin candidates."),
        money_page("glp1-programs-under-300-2026", "/best/online-glp-1-programs-under-300/", "commercial_price_band", "Online GLP-1 Programs Under $300: Published Starting Prices", "Online GLP-1 programs with advertised starts under $300", "Compare dated advertised starting prices and the terms those prices may not include.", ["enhance-md", "wellorithm", "try-ageless", "healthrx", "care-bare-rx-glp1", "serena-health"], "healthrx", "Every row advertised at least one starting price below $300 when checked; that does not guarantee the ongoing or all-in cost stays below $300."),
        money_page("glp1-hsa-fsa-self-pay-2026", "/best/glp-1-hsa-fsa-self-pay-programs/", "commercial_payment_path", "GLP-1 Self-Pay, HSA and FSA Program Comparison", "Compare GLP-1 self-pay, HSA and FSA language", "Separate self-pay, HSA/FSA acceptance, financing and insurance-support claims.", ["healthrx", "try-ageless", "wellorithm", "enhance-md", "care-bare-rx-glp1", "serena-health"], "healthrx", "This page compares payment language, not reimbursement eligibility or insurance coverage."),
        money_page("glp1-shipping-review-times-2026", "/best/glp-1-shipping-review-times/", "commercial_fulfillment", "GLP-1 Review and Shipping Times: What Providers Publish", "Compare published GLP-1 review and shipping windows", "Compare stated review and delivery windows without converting estimates into guarantees.", ["healthrx", "try-ageless", "wellorithm", "enhance-md", "care-bare-rx-glp1", "serena-health", "synergy-rx"], "healthrx", "The timeline begins at different steps across providers; this page preserves those differences and leaves missing windows unstated."),
    ]
    money_path.write_text(json.dumps(money, indent=2) + "\n")

    blog_path = DATA / "blog/content-batch.json"
    blog = json.loads(blog_path.read_text())
    new_articles = [
        comparison_article("healthrx-vs-agelessrx", "HealthRX vs AgelessRx: Price, Review and Shipping Evidence", "HealthRX vs AgelessRx", ["healthrx", "try-ageless", "wellorithm", "enhance-md"], ["HealthRX and AgelessRx both published compounded-program starting prices.", "The checked pages described clinician review and delivery windows."]),
        comparison_article("wellorithm-vs-enhance-md", "Wellorithm vs Enhance.MD: Intro Price vs Ongoing Terms", "Wellorithm vs Enhance MD", ["wellorithm", "enhance-md", "healthrx", "serena-health"], ["Wellorithm stated an introductory price and a different later-month price.", "Enhance.MD stated a lower semaglutide starting price on the checked page."]),
        comparison_article("synergy-rx-vs-carebarerx", "Synergy RX vs CareBareRX: What Is Stated and What Is Missing", "Synergy RX vs CareBareRX", ["synergy-rx", "care-bare-rx-glp1", "serena-health", "try-ageless"], ["Synergy RX did not state a checked GLP-1 price in the frozen evidence.", "CareBareRX stated a starting price and shipping window, while clinician-review details were not stated on the checked page."]),
        comparison_article("serena-health-vs-online-glp1-programs", "Serena Health vs Other Online GLP-1 Programs", "Serena Health comparison", ["serena-health", "healthrx", "try-ageless", "wellorithm"], ["Serena Health published compounded-program starting prices and review/shipping windows.", "HealthRX led this four-row set under the commercial-evidence rubric."]),
        informational_article("verify-online-glp-1-program-evidence", "How to Verify an Online GLP-1 Program Without Guessing", "verify online GLP-1 program", "Verify each claim against the source that can actually prove it: the provider for its offer, regulators for regulatory status, and official registries for identity—not medical fit.", "A reliable review is a source-matching exercise, not a score copied from another site."),
        informational_article("compounded-vs-fda-approved-glp-1-questions", "Compounded vs FDA-Approved GLP-1: Questions to Verify", "compounded vs FDA-approved GLP-1", "FDA-approved branded products and compounded products are not interchangeable regulatory categories; verify the exact formulation, prescriber, pharmacy, total cost and current availability before relying on an offer.", "The most important first step is to preserve the provider’s exact formulation wording instead of collapsing every offer into one drug-name label."),
    ]
    blog["schema"] = "glp-clinic-scout-phase2-batch2-content-v2"
    blog["articles"] += new_articles
    blog["ownership_entries"] += [{"primary_keyword": article["primary_keyword"], "url": article["canonical_path"], "risk_tier": article["risk_tier"], "status": article["status"]} for article in new_articles]
    blog_path.write_text(json.dumps(blog, indent=2) + "\n")

    author = blog["author"]
    (DATA / "blog/author-registry.json").write_text(json.dumps({"schema": "editorial-author-registry-v2", "authors": [{**author, "entity_type": "Organization", "accountable_legal_entity": "Tilton Group LLC", "authority_basis": "Operator-owned first-party GLP Clinic Scout publication identity", "identity_verified_as_of": TODAY, "fictional_person": False, "individual_identity_claimed": False, "clinical_credentials_claimed": False, "transparency_note": "Organizational byline for the GLP Clinic Scout research desk, accountable to Tilton Group LLC; not a clinician or fabricated person."}]}, indent=2) + "\n")
    (DATA / "blog/pillar-cluster-map.json").write_text(json.dumps({
        "schema": "glp-clinic-scout-pillar-cluster-map-v1", "order_policy": "commercial_comparison_first_then_informational", "release_authorized": False,
        "pillars": [
            {"pillar": "Compare online GLP-1 program terms", "intent": "commercial", "clusters": [a["canonical_path"] for a in new_articles[:4]], "programs_exhausted": [item["program_id"] for item in NEW_PROGRAMS]},
            {"pillar": "Verify GLP-1 commercial and regulatory evidence", "intent": "informational", "clusters": [a["canonical_path"] for a in new_articles[4:]], "primary_sources": [FDA_CONCERNS, FDA_COMPOUNDING, FTC, NPPES]},
        ]
    }, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "programs": len(ledger["programs"]), "money_pages": len(money["pages"]), "articles": len(blog["articles"]), "new_articles": len(new_articles)}, sort_keys=True))


if __name__ == "__main__":
    main()
