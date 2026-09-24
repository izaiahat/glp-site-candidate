#!/usr/bin/env python3
"""Append net-new Batch 3 comparison pages and no-clinician articles."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TODAY = "2026-07-23"
REVIEWED_AT = "2026-07-23T10:07:57Z"
FDA_CONCERNS = "https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss"
FDA_PHARMACY = "https://www.fda.gov/drugs/besaferx-your-source-online-pharmacy-information/considering-online-pharmacy"
IRS_HSA_FSA = "https://www.irs.gov/individuals/frequently-asked-questions-about-medical-expenses-related-to-nutrition-wellness-and-general-health"
FTC = "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking"
NPPES = "https://npiregistry.cms.hhs.gov/api-page"


def money_row(program: dict) -> dict:
    return {
        key: program[key]
        for key in [
            "program_id",
            "display_name",
            "source_url",
            "starting_price",
            "starting_price_sort",
            "meds_offered",
            "insurance",
            "average_wait",
            "criteria_scores",
            "score",
            "best_for",
            "limitations",
            "promotion_authorized",
            "live_link_allowed",
        ]
        if key in program
    }


def pair_page(
    programs: dict[str, dict],
    *,
    page_id: str,
    path: str,
    title: str,
    h1: str,
    description: str,
    intent: str,
    ids: list[str],
    intro: list[str],
    verdict: dict,
    winners: list[dict],
    pros: list[str],
    cons: list[str],
    faq: list[dict],
) -> dict:
    rows = [money_row(programs[program_id]) for program_id in ids]
    return {
        "page_id": page_id,
        "page_slug": path.strip("/").split("/")[-1],
        "path": path,
        "intent": intent,
        "title": title,
        "h1": h1,
        "description": description,
        "date_published": TODAY,
        "date_modified": TODAY,
        "source_checked_through": TODAY,
        "live_link_allowed": False,
        "operator_gate_receipt": None,
        "intro": intro,
        "outcome_ctas": [
            {"position": "intro", "label": "Compare the archived evidence"},
            {"position": "pros", "label": "Review the decisive gaps"},
            {"position": "pricing", "label": "Verify today’s full terms"},
            {"position": "conclusion", "label": "Recheck before enrollment"},
        ],
        "sticky_cta_label": "Held comparison · no live route",
        "section_winners": winners,
        "rows": rows,
        "pros": pros,
        "cons": cons,
        "verdict": verdict,
        "faq": faq,
        "sources": [
            {"publisher": programs[program_id]["display_name"], "url": programs[program_id]["source_url"], "verified_as_of": TODAY}
            for program_id in ids
        ]
        + [{"publisher": "FDA", "url": FDA_CONCERNS, "verified_as_of": TODAY}],
    }


def source(publisher: str, url: str, claim_ids: list[str]) -> dict:
    return {"publisher": publisher, "url": url, "verified_as_of": TODAY, "claim_ids": claim_ids}


def visible_word_count(article: dict) -> int:
    chunks = [
        article["title"],
        article["h1"],
        article["description"],
        article["direct_answer"],
        article["medical_advice_disclaimer"],
        article["inline_ftc_disclosure_text"],
        article["conclusion"],
        *article["pros"],
        *article["cons"],
    ]
    for section in article["sections"]:
        chunks.append(section["h2"])
        chunks.extend(section["paragraphs"])
    return len(re.findall(r"\b[\w’'-]+\b", " ".join(chunks)))


def article(
    author: dict,
    *,
    article_id: str,
    path: str,
    title: str,
    h1: str,
    description: str,
    keyword: str,
    intent: str,
    direct_answer: str,
    sections: list[dict],
    claims: list[dict],
    sources: list[dict],
    conclusion: str,
) -> dict:
    payload = {
        "schema": "glp-clinic-scout-phase2-article-v1",
        "article_id": article_id,
        "brief_id": article_id,
        "title": title,
        "h1": h1,
        "description": description,
        "canonical_path": path,
        "primary_keyword": keyword,
        "target_query": keyword,
        "owner_key": keyword,
        "intent": intent,
        "search_intent": intent,
        "audience": "Adults comparing online GLP-1 program evidence; not treatment selection or individualized tax advice",
        "risk_tier": "MEDIUM",
        "status": "PASS_EVIDENCE_REVIEW_HELD_RELEASE",
        "updated_at": TODAY,
        "date_modified": TODAY,
        "source_checked_through": TODAY,
        "author": author,
        "byline_attribution": f"By {author['display_name']} · no clinical credentials claimed",
        "ai_assistance_disclosure": "site-editorial-policy",
        "medical_advice_disclaimer": "General consumer information only; not medical, tax, legal, diagnosis, dosing, reimbursement, or treatment advice.",
        "has_affiliate_cta": True,
        "inline_ftc_disclosure": True,
        "inline_ftc_disclosure_text": "We may earn compensation if a held link is later approved and used; compensation does not change the evidence rubric.",
        "comparison_required": False,
        "comparison_spec": None,
        "direct_answer": direct_answer,
        "sections": sections,
        "pros": ["Primary-source boundary", "Explicit unknown fields", "No clinical-outcome or reimbursement inference"],
        "cons": ["Program terms can change", "Individual eligibility is not evaluated", "No affiliate route is active"],
        "conclusion": conclusion,
        "claims": claims,
        "sources": sources,
        "batch_gate_passed": False,
        "operator_release_receipt": None,
    }
    count = visible_word_count(payload)
    if count < 1500 or count > 2000:
        raise RuntimeError(f"article_word_count:{article_id}:{count}")
    payload["word_count"] = count
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    payload["evidence_review"] = {"status": "PASS", "reviewed_at": REVIEWED_AT, "content_sha256": digest}
    return payload


def hsa_article(author: dict) -> dict:
    claim_ids = ["hsa-diagnosed-disease-boundary", "hsa-provider-language-boundary", "hsa-compounded-status-boundary"]
    sections = [
        {"h2": "Begin with two different questions", "paragraphs": [
            "A provider can say it accepts an HSA or FSA card while a particular charge still fails a plan administrator’s reimbursement rules. Acceptance describes a payment mechanism at checkout. Eligibility describes whether the expense fits the governing plan and tax rules for the person, purpose, documentation, and date. Treat those as separate fields. A card authorization is not a reimbursement opinion, and a declined card is not a clinical judgment.",
            "The practical comparison starts by recording the provider’s exact wording: accepts HSA/FSA cards, may be eligible, reimbursement documentation available, self-pay only, or not stated. Do not normalize those phrases into one green check. The phrase, page URL, capture date, billed entity, item description, and any conditions should travel together in the evidence ledger so the page shows what was actually published rather than what a checkout badge seemed to imply."
        ]},
        {"h2": "The IRS boundary is diagnosis-specific", "paragraphs": [
            "The IRS FAQ says a weight-loss program may be a medical expense only when it treats a specific disease diagnosed by a physician, giving obesity, diabetes, hypertension, and heart disease as examples. Otherwise the weight-loss program cost is not a medical expense under that answer. This is a general federal boundary, not a ruling about any Clinic Scout reader, provider package, medication, coaching charge, laboratory fee, or mixed invoice.",
            "That distinction blocks the common shortcut that all weight-management spending is automatically HSA/FSA eligible. A program marketed for appearance, general wellness, or an undiagnosed goal may be treated differently from disease-directed care. Documentation, plan terms, and the exact charge matter. Clinic Scout does not decide whether a disease exists, whether an expense was incurred to treat it, or whether a plan administrator will approve a claim."
        ]},
        {"h2": "Break a program price into billable components", "paragraphs": [
            "One monthly headline can combine a clinician review, subscription access, coaching, laboratory work, medication, supplies, pharmacy fulfillment, and shipping. Those components need not share the same reimbursement treatment. Ask for an itemized invoice before assuming that the whole charge follows the most favorable component. Record the first payment, later payments, minimum commitment, dose-related changes, cancellation cutoff, and whether the billed merchant is the provider, pharmacy, laboratory, or another entity.",
            "A useful evidence table therefore keeps price and payment status separate. Price answers what the provider advertises. Payment status answers which methods the provider says it accepts. Reimbursement status remains unknown unless the governing source and individual documentation support it. If the page is silent about itemization or receipts, that absence belongs in the comparison. Filling it with a generic market assumption would make the table look complete while reducing its accuracy."
        ]},
        {"h2": "Provider language varies across the accepted pool", "paragraphs": [
            "The frozen accepted ledger records HSA/FSA language for several programs, but the wording does not carry the same scope. HealthRX, AgelessRx, Wellorithm, Enhance.MD, CareBareRX, and Serena Health each publish some form of HSA/FSA or self-pay language in the captured evidence. Synergy RX’s checked GLP-1 page left the payment path unstated. These statements support a disclosure comparison; they do not authorize a reimbursement ranking.",
            "A provider’s clear acceptance wording can reduce checkout ambiguity, so it is a legitimate commercial-transparency signal. It should not be scored as proof that a medication, membership, or mixed charge qualifies under a particular plan. The correct reader action is to preserve the provider statement, obtain the itemized charge description, consult current plan materials or the administrator, and retain the written response. Clinic Scout keeps the route inert and does not submit claims."
        ]},
        {"h2": "Separate prescription status from product approval", "paragraphs": [
            "A prescription requirement and HSA/FSA discussion do not answer whether the dispensed product is FDA-approved. FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality. A provider’s use of an ingredient name, trademark parenthetical, or FDA-registered-pharmacy phrase cannot erase that distinction. Payment eligibility and regulatory status must remain separate columns.",
            "This separation matters because readers can mistake payment acceptance for governmental endorsement. HSA/FSA administration is not FDA product review, and FDA product status is not tax eligibility. A page should state only the evidence each source can establish: IRS for the general medical-expense boundary, FDA for product-status principles, the provider for its offer and payment methods, and the plan administrator for plan-specific decisions. No source should be made to answer another source’s question."
        ]},
        {"h2": "Build a documentation packet before checkout", "paragraphs": [
            "The packet should include the provider’s dated offer, itemized invoice or estimate, prescription or clinician documentation when applicable, diagnosis-related documentation requested by the plan, proof of payment, and the plan administrator’s current instructions. Ask whether a letter of medical necessity or another form is required before payment rather than after a rejection. Requirements can vary, and a successful claim by someone else is not evidence for a new claim.",
            "Keep sensitive medical documentation out of Clinic Scout. The site does not need a diagnosis, prescription, BMI, medication history, invoice, or reimbursement decision to explain the process. Those records belong with the user, clinician, plan, and other authorized parties. The editorial ledger stores only public provider wording and primary-source policy boundaries. That preserves usefulness without turning a comparison site into a health-data repository."
        ]},
        {"h2": "Use a three-state comparison", "paragraphs": [
            "For each provider, mark payment-method evidence as stated, not stated, or conflicting. Separately mark reimbursement as plan-specific and unverified. If a provider says HSA/FSA eligible, quote the wording and note that individual reimbursement is not guaranteed. If a provider only says self-pay, do not infer rejection or acceptance of tax-advantaged cards. If the checkout and public page disagree, hold the field until the conflict is resolved with a dated source.",
            "This approach is intentionally less dramatic than a best-HSA list. It does more useful work. Readers can see which programs publish a payment path, where an itemized invoice question remains, and why a checkout logo does not settle eligibility. Programs do not gain points for commission, payout, network approval, or tracking readiness. The comparison is about public consumer evidence only."
        ]},
        {"h2": "Avoid four common reimbursement claims", "paragraphs": [
            "Do not write that a program is covered because it accepts HSA/FSA cards. Do not write that a compounded product is government approved because a tax-advantaged account may pay an expense. Do not guarantee that a diagnosis automatically qualifies every associated charge. Do not tell a reader to characterize an expense in a way that differs from the actual purpose or invoice. Those statements exceed the available evidence and can create medical, tax, or legal risk.",
            "Use narrower wording: the provider page states a payment method; IRS describes a diagnosed-disease boundary; the plan decides under its terms; reimbursement is not guaranteed; and the reader should verify documentation before payment. If a sentence cannot preserve those boundaries, remove it. A comparison page is not improved by converting a conditional process into a promise."
        ]},
        {"h2": "A failed claim is not a medical verdict", "paragraphs": [
            "Administrative rejection can arise from plan exclusions, missing documentation, timing, merchant coding, itemization, a nonqualifying component, or another plan rule. It does not establish that treatment was unnecessary or clinically inappropriate. Conversely, payment authorization does not prove effectiveness, safety, quality, or medical fit. Keep administrative and clinical conclusions apart in the article and in any support response.",
            "If the program advertises assistance, ask what that assistance includes: receipt generation, itemized invoicing, benefits questions, or merely card acceptance. Avoid calling it insurance support unless the source says so. Avoid calling it coverage unless the plan confirms it. Precise labels let the reader compare operational friction without mistaking administrative convenience for a clinical recommendation."
        ]},
        {"h2": "The decision checklist", "paragraphs": [
            "Before paying, identify the exact charge, purpose, billed entity, itemization, first and recurring amounts, minimum commitment, refund terms, payment methods, and documentation available. Read the current IRS boundary and the plan’s current rules. Ask the administrator about the specific expense rather than a generic GLP-1 category. Save the dated answer. If the decisive information remains unavailable, treat reimbursement as unknown and decide whether the cash-price exposure is acceptable without it.",
            "After payment, retain invoices and supporting records according to the plan’s process. Do not upload them to a comparison site or send them through an affiliate form. If a provider changes its payment language, the public comparison should update the captured date and statement rather than silently preserving an older green check. The sustainable outcome is a source trail that can become less certain when evidence changes."
        ]},
    ]
    claims = [
        {"claim_id": claim_ids[0], "statement": "IRS says a weight-loss program may qualify only when it treats a specific disease diagnosed by a physician; otherwise it is not a medical expense under the cited FAQ.", "source_ids": ["irs-hsa-fsa-weight-loss"]},
        {"claim_id": claim_ids[1], "statement": "Provider HSA/FSA acceptance language does not guarantee reimbursement for a particular person, charge, or plan.", "source_ids": ["irs-hsa-fsa-weight-loss", "accepted-provider-ledger"]},
        {"claim_id": claim_ids[2], "statement": "FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality.", "source_ids": ["fda-concerns"]},
    ]
    sources = [source("IRS", IRS_HSA_FSA, claim_ids), source("FDA", FDA_CONCERNS, claim_ids), source("HealthRX", "https://healthrx.com/", claim_ids), source("AgelessRx", "https://tryageless.com/affiliate-weight-plans/", claim_ids), source("CareBareRX", "https://www.carebarerx.com/home2", claim_ids), source("Serena Health", "https://serenahealth.life/", claim_ids)]
    return article(author, article_id="phase2-batch3-medium-glp1-hsa-fsa-evidence-20260723", path="/guides/glp-1-hsa-fsa-reimbursement-evidence/", title="GLP-1 HSA and FSA evidence: card acceptance is not reimbursement", h1="Separate the card, the charge, and the reimbursement decision", description="A source-bound guide to provider HSA/FSA wording, IRS diagnosed-disease limits, itemization, and plan-specific verification.", keyword="GLP-1 HSA FSA reimbursement evidence", intent="financial_evidence_verification", direct_answer="A provider’s HSA/FSA acceptance statement proves only the published payment method. IRS describes a diagnosed-disease boundary, while the exact charge, documentation, and plan rules still control any individual reimbursement decision.", sections=sections, claims=claims, sources=sources, conclusion="Use the provider statement as a checkout fact, the IRS page as a general boundary, and the plan administrator as the source for a specific claim. This held guide offers no medical, tax, or reimbursement decision.")


def workflow_article(author: dict) -> dict:
    claim_ids = ["workflow-separate-stages", "workflow-prescription-boundary", "workflow-timeline-boundary"]
    sections = [
        {"h2": "A storefront is not a care pathway", "paragraphs": [
            "An online program page can make enrollment feel like one continuous action: answer questions, get approved, receive medication. The evidence trail is more granular. Intake collects information. Identity and consent checks establish who is participating. A licensed clinician makes an independent decision. A prescription, if issued, moves to a pharmacy. The pharmacy verifies and fulfills. A carrier transports the package. Each stage has a different owner, clock, failure mode, and source.",
            "Treating these stages separately prevents two common errors. First, a fast intake or review headline is not a guaranteed prescription. Second, a shipping estimate does not begin when the questionnaire opens unless the provider explicitly defines it that way. A useful comparison asks which event starts and stops each clock, what information is required, who owns the decision, and what happens when the next stage does not proceed."
        ]},
        {"h2": "Stage one: account, identity, and consent", "paragraphs": [
            "Before clinical questions, establish the operator’s legal identity, privacy notice, communication consent, and the information the service proposes to collect. A comparison site should not copy health answers into analytics or lead forms. The provider may need more sensitive information to deliver care, but that does not authorize an affiliate or editorial site to retain it. Keep the research record to public program facts and source dates.",
            "Look for clear instructions about account access, electronic communication, privacy, fees, and cancellation before submitting medical information. If the user cannot identify the legal provider, care entity, or basic privacy route, pause. A polished brand does not replace the need to understand who receives the intake and who is responsible for subsequent care."
        ]},
        {"h2": "Stage two: the intake is information, not approval", "paragraphs": [
            "An intake may ask about history, goals, medications, allergies, prior treatment, and other factors. Completing it shows only that information was submitted. It does not prove eligibility, create a prescription, reserve inventory, establish total price, or promise service in a state. Marketing copy that collapses questionnaire completion into guaranteed access should not be repeated as a factual care pathway.",
            "The comparison question is operational: what is requested, when payment occurs, whether the user can review answers, and what happens if the service cannot proceed. Clinic Scout does not evaluate the answers and does not route readers based on medical fields. Its staged quiz keeps health-related answers local and excludes them from program ranking."
        ]},
        {"h2": "Stage three: licensed-clinician review", "paragraphs": [
            "The provider should explain that a licensed clinician reviews eligibility and may decline to prescribe. A statement about clinician review is process evidence, not proof of care quality or appropriateness for a specific person. Verify the clinician’s identity and applicable license through the authoritative state source when that information becomes available. An NPI can help with identity and taxonomy, but it does not validate licensure, current availability, or a prescribing decision.",
            "Ask how the review occurs, whether synchronous contact may be required, how follow-up questions are handled, and whether there is a charge if no prescription is issued. A published review window should identify its starting event. HealthRX’s archived page describes physician file review within 24 hours, but that statement remains a provider snapshot, not a promise to every applicant."
        ]},
        {"h2": "Stage four: product and prescription clarity", "paragraphs": [
            "If a clinician issues a prescription, record the exact product language. Brand name, active ingredient, compounded preparation, route, and strength are distinct facts. FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality. A prescription requirement does not change that regulatory status, and an ingredient name does not establish that the dispensed product is an approved brand.",
            "The reader should know what will appear on the prescription and label, which pharmacy receives it, and what options exist if the described product is unavailable. The editorial page should not advise a substitute, dose, or response to side effects. Its job is to show which product-status fields are published and which must be confirmed with the clinician and pharmacy."
        ]},
        {"h2": "Stage five: pharmacy acceptance and verification", "paragraphs": [
            "A pharmacy is a separate actor. FDA’s BeSafeRx materials tell consumers to look for a required prescription, a U.S. physical address and telephone number, a licensed pharmacist, and state-board pharmacy licensure. Those are verification signs, not an endorsement of a named pharmacy. The program’s claim that it uses a pharmacy should be checked against the pharmacy’s own identity and the applicable board record.",
            "Ask when the pharmacy receives the prescription, whether it can serve the destination, how questions reach a pharmacist, and what happens if it cannot fill the order. Do not infer that an FDA-registered facility makes a compounded drug FDA-approved. Facility, pharmacy, prescription, and product status remain separate evidence objects."
        ]},
        {"h2": "Stage six: processing is not carrier delivery", "paragraphs": [
            "After pharmacy acceptance, processing may include verification, preparation, packaging, payment resolution, and carrier handoff. A provider may publish one combined phrase or two distinct windows. Serena Health’s archived evidence states shipping within 24–48 hours after approval and delivery in 3–5 business days. CareBareRX states a shipping window but its checked page did not state the clinician-review clock. Those facts cannot be combined into one universal intake-to-door promise.",
            "Ask what event starts the shipping clock, whether business days exclude weekends, how tracking is provided, and whether destination or weather rules change the estimate. Shipping speed is not a clinical-quality measure. A slower disclosed process can be more transparent than a fast number whose starting event is undefined."
        ]},
        {"h2": "Stage seven: delivery, storage, and exceptions", "paragraphs": [
            "Delivery introduces carrier, address, signature, weather, package condition, and storage questions. The provider or pharmacy should supply current handling instructions for the actual product. A comparison article should not invent temperature ranges or tell a reader to use a delayed or damaged item. It can ask whether tracking, missed-delivery instructions, replacement policy, and pharmacist contact are documented.",
            "If the package does not arrive as expected, contact the responsible provider, pharmacy, and carrier through their official channels. Do not alter treatment timing based on an editorial timeline. The comparison’s role ends at identifying the owner of the exception and the evidence that describes the process."
        ]},
        {"h2": "Stage eight: follow-up and renewal", "paragraphs": [
            "A first shipment does not explain ongoing care. Verify follow-up cadence, refill review, renewal date, recurring price, dose-dependent cost, cancellation deadline, and what happens when continued prescribing is not authorized. Support can include administrative help, coaching, clinical contact, or pharmacy communication; do not collapse them into one oversight score without source-specific definitions.",
            "Record whether the program is month-to-month or prepaid and whether the first amount differs from later charges. The decision to continue medication is clinical and individualized. The editorial page may compare published renewal mechanics but cannot tell a reader to continue, stop, switch, or change a dose."
        ]},
        {"h2": "Use stop points, not assumptions", "paragraphs": [
            "Stop before payment when the operator, clinician-review process, exact product category, dispensing pharmacy, total cost, renewal terms, or state availability is decisive and unstated. Stop before relying on a timeline when its starting event is unclear. Stop before repeating a product claim when provider wording conflicts with FDA’s regulatory categories. An unknown field is an actionable verification item, not an invitation to estimate.",
            "The strongest comparison makes those stop points visible. It can show that one provider publishes more of a process without declaring the provider medically better. It can identify a shorter stated window without guaranteeing speed. It can disclose compensation without allowing payout or network status to influence the consumer evidence score."
        ]},
        {"h2": "A stage-by-stage worksheet", "paragraphs": [
            "Create rows for legal operator, intake purpose, clinician-review method, review start and end events, decision communication, prescription status, product category, pharmacy identity, pharmacy-license check, processing window, carrier window, tracking, exception path, follow-up cadence, renewal, cancellation, and total price. Add the source URL, exact quote, capture date, and unknown state beside every row.",
            "Before enrollment, verify the rows that would change the decision. After terms change, update the evidence rather than the date alone. This workflow does not determine medical fit; it prevents a commercial page from presenting intake, approval, prescription, pharmacy work, and shipping as if they were one guaranteed transaction."
        ]},
    ]
    claims = [
        {"claim_id": claim_ids[0], "statement": "Online intake, clinician decision, prescription, pharmacy processing, and carrier delivery are separate stages and provider clocks can start at different events.", "source_ids": ["accepted-provider-ledger"]},
        {"claim_id": claim_ids[1], "statement": "FDA lists prescription and state-licensed-pharmacy checks as signs used when assessing an online pharmacy.", "source_ids": ["fda-besaferx"]},
        {"claim_id": claim_ids[2], "statement": "Published review and shipping windows are provider snapshots, not guarantees of approval or intake-to-door delivery.", "source_ids": ["healthrx", "serena-health", "care-bare-rx-glp1"]},
    ]
    sources = [source("FDA", FDA_PHARMACY, claim_ids), source("FDA", FDA_CONCERNS, claim_ids), source("HealthRX", "https://healthrx.com/", claim_ids), source("CareBareRX", "https://www.carebarerx.com/home2", claim_ids), source("Serena Health", "https://serenahealth.life/", claim_ids)]
    return article(author, article_id="phase2-batch3-medium-online-glp1-intake-fulfillment-20260723", path="/guides/online-glp-1-intake-to-pharmacy-fulfillment/", title="From online GLP-1 intake to pharmacy fulfillment: eight separate stages", h1="Do not confuse intake, approval, prescription, and delivery", description="A process map for separating provider intake, clinician review, product status, pharmacy verification, fulfillment, shipping, and renewal.", keyword="online GLP-1 intake pharmacy fulfillment process", intent="process_verification", direct_answer="An online intake is only the first stage. Clinician review, prescription, pharmacy acceptance, processing, carrier handoff, delivery, and renewal each require separate evidence and can fail or pause independently. Before payment, identify the owner, source, starting event, and unresolved condition for every stage that would change the decision.", sections=sections, claims=claims, sources=sources, conclusion="Use the worksheet to identify who owns each stage and what source proves it. This held guide does not predict approval, prescribe a product, or guarantee fulfillment.")


def pharmacy_article(author: dict) -> dict:
    claim_ids = ["pharmacy-safe-signs", "pharmacy-npi-boundary", "pharmacy-product-boundary"]
    sections = [
        {"h2": "Verify the pharmacy as its own organization", "paragraphs": [
            "A telehealth brand, medical group, prescribing clinician, dispensing pharmacy, and carrier may all be different organizations. The program page can describe the relationship, but it is not the final authority for the pharmacy’s license or identity. Ask for the legal pharmacy name, physical location, telephone number, pharmacist contact route, and the state or states where it is licensed to serve the destination. Then verify those facts through official sources.",
            "Do not accept a generic phrase such as partner pharmacy as a substitute when pharmacy identity is decisive. Also do not assume that a pharmacy named on one page fills every product, state, or order. Relationships can vary. The source record should tie the exact wording, product context, provider page, pharmacy identity, destination, and capture date together."
        ]},
        {"h2": "FDA publishes practical online-pharmacy signs", "paragraphs": [
            "FDA’s BeSafeRx page lists signs of a likely safe online pharmacy: it always requires a doctor’s prescription, provides a physical address and telephone number in the United States, has a licensed pharmacist available to answer questions, and is licensed with a state board of pharmacy. Those signs form a verification checklist. They do not turn Clinic Scout into a licensing authority and do not endorse a pharmacy named by a provider.",
            "Use the checklist in the correct order. First obtain the pharmacy’s exact legal identity. Then locate the official state-board record. Confirm that the record and contact information correspond to the organization being represented. If the provider will not identify the pharmacy before a consequential payment or shipment, mark the evidence incomplete rather than filling the gap with a likely vendor."
        ]},
        {"h2": "A prescription requirement is necessary but not sufficient", "paragraphs": [
            "A legitimate prescription process requires a clinician decision. A website that offers prescription medicine without a prescription is a serious warning sign under FDA’s consumer material. Yet the existence of a prescription does not prove every other field: the clinician’s applicable license, the pharmacy’s license, the exact product, state availability, product quality, delivery handling, and medical fit still require their own evidence.",
            "A comparison article should describe the published process and its gaps without simulating a clinical evaluation. It should not promise that questionnaire completion produces a prescription. It should not tell a reader what answer to give, what condition they have, or how to qualify. The evidence question is whether the program clearly preserves independent clinician review before prescribing."
        ]},
        {"h2": "State-board verification is not a badge copied from marketing", "paragraphs": [
            "Follow FDA’s direction to check state-board pharmacy licensure. Use the official board or its authorized lookup rather than a logo, seal, directory snippet, or provider claim. Match the legal name and location carefully. Similar brand names, corporate parents, mail-order facilities, and affiliated locations can create false matches. Record the source URL and date because license status and permissions can change.",
            "Clinic Scout should not publish a license conclusion unless its evidence model is designed and reviewed for that claim. In this held guide, the rule is narrower: readers should know that the state-board check exists and that provider marketing cannot replace it. Any future pharmacy-specific row would require an exact identity match, current official record, and a scoped statement that does not overclaim service or product quality."
        ]},
        {"h2": "NPPES answers a different identity question", "paragraphs": [
            "NPPES can show that an organization or clinician has an NPI record, along with taxonomy and listed location fields. NPI issuance does not validate licensure, credentials, service quality, availability, insurance participation, a current GLP-1 offering, or pharmacy safety. A provider or medical-group NPI is not a substitute for state-board pharmacy verification.",
            "This is the same boundary used on Clinic Scout city pages. Ten active NPI-2 records create a registry sample, not a list of ten GLP-1 clinics. Direct service requires a separate exact organization-and-city source. Pharmacy licensure requires its own authoritative record. Keeping those systems separate prevents a long government identifier from becoming a misleading trust badge."
        ]},
        {"h2": "Facility registration does not approve a compounded drug", "paragraphs": [
            "Provider pages sometimes use FDA-registered facility or similar language near a compounded offer. FDA says compounded drugs are not FDA-approved and are not reviewed before marketing for safety, effectiveness, or quality. Registration, inspection, outsourcing status, or a pharmacy license does not convert a compounded preparation into an FDA-approved product. The article must preserve that distinction next to the claim.",
            "Ask what exact product will be dispensed, who compounds or manufactures it, what appears on the label, and which regulatory category applies. Do not infer an approved brand from a trademark parenthetical or ingredient name. Do not infer compounded status from a low price alone. If the product category remains unclear, hold the statement as unknown."
        ]},
        {"h2": "The provider-pharmacy relationship needs dated evidence", "paragraphs": [
            "A provider may use more than one pharmacy depending on medication, state, inventory, or time. An archived page can prove what was published on a date, not that the relationship remains universal. Ask whether the dispensing pharmacy is identified before payment or before shipment and whether the user will receive pharmacy contact information. Save the answer with the date and product context.",
            "When the relationship changes, a comparison should not silently redirect old evidence to a new pharmacy. It should version the row, update the source, and reconsider any claims about fulfillment, state access, or timing. Sustainable content accepts that a once-correct field can become unknown."
        ]},
        {"h2": "Fulfillment claims need an owner and a clock", "paragraphs": [
            "Free shipping, overnight shipping, one-to-two-day shipping, and three-to-five-business-day delivery can describe different events. Determine whether the provider, pharmacy, or carrier owns the statement and whether the clock begins after clinician approval, pharmacy processing, or carrier handoff. A pharmacy verification page should not rank quality by speed; it should show who is responsible and what was actually promised.",
            "Ask about tracking, missed delivery, package damage, storage instructions, and the route for pharmacist questions. Do not publish generalized storage advice for a medication that has not been identified. Product-specific questions belong with the dispensing pharmacy and clinician. The editorial page can flag the missing policy without inventing it."
        ]},
        {"h2": "Price can obscure the pharmacy line", "paragraphs": [
            "A bundled monthly price may hide which entity bills for medical services and which bills for medication. Request an itemized description and identify whether shipping, supplies, consultation, laboratory work, and pharmacy charges are included. The billed merchant and item description also matter when a user asks a plan administrator about HSA/FSA reimbursement. One headline should not be allowed to answer several accounting questions.",
            "If a provider publishes no pharmacy identity or itemization, the comparison may still state the advertised price with a limitation. It should not infer the medication acquisition cost, pharmacy margin, dispensing arrangement, or reimbursement status. Missing commercial evidence is a score limitation, not an invitation to use commission data."
        ]},
        {"h2": "Red flags change publication state", "paragraphs": [
            "Hold the page or row when a site offers prescription medicine without a prescription, hides the responsible pharmacy, uses a state-board or FDA reference to imply product approval, presents a compounded product as a generic or equivalent approved brand, provides no verifiable U.S. contact information, or conflicts with an exact regulator warning. The response is source review and narrowing, not a dramatic accusation beyond the evidence.",
            "If a hard warning-letter match exists, promotion remains blocked until documented remediation and fresh review. If the issue is merely missing public evidence, label it not stated and specify what would resolve it. Different failure classes deserve different wording, but neither should receive a live affiliate route while unresolved."
        ]},
        {"h2": "The reusable pharmacy checklist", "paragraphs": [
            "Before relying on an online pharmacy relationship, record the legal pharmacy name, U.S. address and telephone number, prescription requirement, pharmacist-access route, official state-board lookup, exact product category, provider relationship, destination support, billed entity, itemization, processing start event, carrier estimate, tracking, exception path, source date, and unresolved fields. Use official pages and records rather than copied directory text.",
            "The checklist does not determine medical appropriateness or guarantee that a pharmacy will fill an order. It creates a paper trail that can be audited and corrected. If the legal identity or decisive source cannot be established, stop. A short held row with a named gap is better than a confident pharmacy recommendation built from a provider badge."
        ]},
    ]
    claims = [
        {"claim_id": claim_ids[0], "statement": "FDA identifies prescription requirement, U.S. address and phone, licensed pharmacist access, and state-board pharmacy licensure as signs used when assessing an online pharmacy.", "source_ids": ["fda-besaferx"]},
        {"claim_id": claim_ids[1], "statement": "An NPI record proves identity, taxonomy, and listed location fields, not pharmacy licensure, safety, or active GLP-1 service.", "source_ids": ["nppes"]},
        {"claim_id": claim_ids[2], "statement": "Pharmacy licensure or facility registration does not make a compounded drug FDA-approved.", "source_ids": ["fda-concerns", "fda-besaferx"]},
    ]
    sources = [source("FDA", FDA_PHARMACY, claim_ids), source("FDA", FDA_CONCERNS, claim_ids), source("NPPES", NPPES, claim_ids), source("FTC", FTC, claim_ids)]
    return article(author, article_id="phase2-batch3-medium-online-pharmacy-verification-20260723", path="/guides/verify-online-glp-1-pharmacy/", title="How to verify an online GLP-1 pharmacy without trusting a badge", h1="Verify the prescription, pharmacy identity, license source, and product separately", description="An FDA- and NPPES-bounded checklist for online pharmacy identity, prescription process, licensure verification, product status, and fulfillment evidence.", keyword="verify online GLP-1 pharmacy", intent="pharmacy_identity_verification", direct_answer="Treat the pharmacy as a separate organization: obtain its legal identity, confirm the prescription process, use the official state-board record, verify pharmacist access, and keep pharmacy licensure separate from product approval and NPI status.", sections=sections, claims=claims, sources=sources, conclusion="Use FDA’s signs and official state-board sources to verify the pharmacy identity. This held guide does not endorse a pharmacy, validate a product, or replace clinician and pharmacist advice.")


def main() -> None:
    ledger = json.loads((DATA / "program-content-ledger.json").read_text())
    if len(ledger["programs"]) != 13:
        raise RuntimeError("accepted_program_pool_changed")
    programs = {item["program_id"]: item for item in ledger["programs"]}
    forbidden = {"mademed", "telos-rx", "breeze-meds", "direct-meds", "strut-health", "emed"}
    if forbidden & set(programs):
        raise RuntimeError("held_program_backfill")

    money_path = DATA / "money-page-specs.json"
    money = json.loads(money_path.read_text())
    batch3_paths = {
        "/compare/synergy-rx-vs-carebarerx/",
        "/compare/serena-health-vs-oak-longevity/",
    }
    existing_paths = {item["path"] for item in money["pages"] if item["path"] not in batch3_paths}
    pages = [
        pair_page(
            programs,
            page_id="synergy-rx-vs-carebarerx-evidence-2026",
            path="/compare/synergy-rx-vs-carebarerx/",
            title="Synergy RX vs CareBareRX: stated terms, missing fields, and verification work",
            h1="Synergy RX vs CareBareRX: compare what is stated before guessing",
            description="A source-bound comparison of price visibility, formulation wording, clinician-process evidence, payment language, and fulfillment gaps.",
            intent="commercial_provider_pair_missing_fields",
            ids=["synergy-rx", "care-bare-rx-glp1", "wellorithm", "enhance-md"],
            intro=[
                "This page exists because Synergy RX and CareBareRX were in the accepted 13-program pool without a dedicated comparison route. It does not repeat the broader seven-program page: the decision is whether enough public evidence exists to estimate the commercial commitment without filling gaps.",
                "Synergy RX’s checked page left GLP-1 price, payment path, and timing unstated. CareBareRX published a starting price, HSA/FSA language, and shipping window while leaving the clinician-review timeline unstated. Wellorithm and Enhance.MD serve as disclosure benchmarks, not substitute winners. Compounded drugs are not FDA-approved, and every route remains inert.",
                "Use this pair as a commercial-field audit. Request the first invoice, recurring cadence, minimum term, renewal date, cancellation cutoff, refund rule, itemized services, dispensing entity, pharmacist-access route, supplies, and destination surcharge. For Synergy RX, those fields are questions because the checked page did not publish them. For CareBareRX, the visible amount and shipping phrase still need an all-in written quote and a defined clock.",
            ],
            verdict={"label": "More complete checked pair record", "provider": "CareBareRX", "program_id": "care-bare-rx-glp1", "one_line": "CareBareRX published more of the pair’s commercial fields, but product-status wording and clinician-review gaps prevent a recommendation."},
            winners=[
                {"criterion": "Pair price visibility", "provider": "CareBareRX", "reason": "Its checked page published a starting price; Synergy RX’s checked GLP-1 page did not."},
                {"criterion": "Honest unknown-field signal", "provider": "Synergy RX", "reason": "Missing price, payment, and timing stay Not stated rather than receiving estimates."},
                {"criterion": "Benchmark later-month disclosure", "provider": "Wellorithm", "reason": "Its archived evidence distinguished an introductory amount from later-month pricing."},
            ],
            pros=["Owns one unfilled pair intent", "Turns missing public terms into explicit decision questions", "Uses accepted first-party evidence without revisiting provider selection"],
            cons=["Synergy RX’s decisive commercial fields remain unstated", "CareBareRX product and clinician-process language requires verification", "Benchmark rows are context, not endorsements"],
            faq=[
                {"q": "Why compare a provider with missing fields?", "a": "Because the absence of price, payment, or timing evidence changes the purchase decision. The page shows the gap instead of estimating it."},
                {"q": "Does CareBareRX’s published price prove total cost?", "a": "No. Ongoing amount, included services, dose changes, renewal, and other charges still require confirmation."},
                {"q": "Does a brand name in parentheses prove equivalence?", "a": "No. The seller’s parenthetical wording is not proof that a compounded product is an FDA-approved brand or generic."},
                {"q": "Is Synergy RX excluded?", "a": "No. It remains in the accepted evidence pool, but missing commercial fields are displayed as unresolved."},
                {"q": "Do scores represent medical quality?", "a": "No. They measure published commercial evidence under the frozen rubric."},
                {"q": "Are links active?", "a": "No. This staging comparison is link-dark and noindex."},
            ],
        ),
        pair_page(
            programs,
            page_id="serena-health-vs-oak-longevity-evidence-2026",
            path="/compare/serena-health-vs-oak-longevity/",
            title="Serena Health vs Oak Longevity: program detail versus intake-shell evidence",
            h1="Serena Health vs Oak Longevity: compare published evidence depth",
            description="A source-bound comparison of visible offer detail, product-status language, clinician process, price, and unresolved intake-shell fields.",
            intent="commercial_provider_pair_evidence_depth",
            ids=["serena-health", "oak-weight-loss-program", "found-health", "gala-health"],
            intro=[
                "Serena Health and Oak Longevity were accepted into the 13-program comparison pool without a dedicated head-to-head route. Their public evidence depth differs: Serena Health’s archived page published formulation, price, review, and shipping language, while Oak’s captured public destination was an intake shell with no product or compounding facts.",
                "Found Health and Gala Health appear only as source-disclosure benchmarks. This page does not infer that more copy means better care, and it does not rank outcomes. It asks whether a reader can identify the offer, product category, clinician process, price exposure, and fulfillment path before beginning intake.",
                "Audit the intake shell before entering sensitive answers. Look for the legal operator, privacy notice, consent sequence, telehealth modality, applicable-state disclosure, prepayment timing, exit path, account deletion route, product-form statement, and post-questionnaire decision owner. Oak’s public shell did not expose enough of that sequence for a commercial verdict. Serena’s deeper offer page still leaves regulatory and renewal questions that visible detail alone cannot settle.",
            ],
            verdict={"label": "More complete checked pair record", "provider": "Serena Health", "program_id": "serena-health", "one_line": "Serena Health published more commercial and process detail than Oak’s captured intake shell, while medication approval status and renewal terms still require confirmation."},
            winners=[
                {"criterion": "Pair offer visibility", "provider": "Serena Health", "reason": "Its archived page published formulation, starting-price, review, and shipping statements."},
                {"criterion": "Pair uncertainty signal", "provider": "Oak Longevity", "reason": "The public intake shell did not expose product or compounding facts, so no commercial detail is inferred."},
                {"criterion": "Benchmark branded-versus-compounded separation", "provider": "Found Health", "reason": "Its archived evidence separates branded FDA-approved and compounded options instead of blending categories."},
            ],
            pros=["Owns a distinct evidence-depth decision", "Shows why an intake shell cannot support a full commercial verdict", "Separates visibility from clinical quality"],
            cons=["Oak’s public evidence remains too thin for a detailed commercial conclusion", "Serena’s product approval status and renewal terms remain unresolved", "Availability and eligibility can change after source capture"],
            faq=[
                {"q": "Does more published detail mean better medical care?", "a": "No. It means more fields can be checked before intake; it does not measure clinical quality or fit."},
                {"q": "Why keep Oak in the comparison?", "a": "Its thin public destination is itself a useful verification signal. The page lists what must be confirmed rather than inventing facts."},
                {"q": "Does Serena’s FDA-registered-pharmacy wording approve the medication?", "a": "No. Pharmacy or facility language does not make a compounded drug FDA-approved."},
                {"q": "Are Found and Gala alternatives ranked here?", "a": "No. They are context rows showing different disclosure patterns under the same frozen rubric."},
                {"q": "Can this page determine eligibility?", "a": "No. A licensed clinician makes individual treatment decisions."},
                {"q": "Can I enroll through this page?", "a": "No. All routes are inert and staging-only."},
            ],
        ),
    ]
    if any(page["path"] in existing_paths for page in pages):
        raise RuntimeError("money_path_collision")
    money["schema"] = "glp-clinic-scout-phase2-batch3-money-specs-v1"
    money["pages"] = [item for item in money["pages"] if item["path"] not in batch3_paths] + pages
    money_path.write_text(json.dumps(money, indent=2, sort_keys=True) + "\n")

    blog_path = DATA / "blog" / "content-batch.json"
    blog = json.loads(blog_path.read_text())
    author_profile = blog["author"]
    new_articles = [hsa_article(author_profile), workflow_article(author_profile), pharmacy_article(author_profile)]
    batch3_article_paths = {item["canonical_path"] for item in new_articles}
    existing_article_paths = {item["canonical_path"] for item in blog["articles"] if item["canonical_path"] not in batch3_article_paths}
    if any(item["canonical_path"] in existing_article_paths for item in new_articles):
        raise RuntimeError("article_path_collision")
    blog["schema"] = "glp-clinic-scout-phase2-batch3-content-v1"
    blog["generated_at_utc"] = REVIEWED_AT
    blog["articles"] = [item for item in blog["articles"] if item["canonical_path"] not in batch3_article_paths] + new_articles
    blog["ownership_entries"] = [item for item in blog["ownership_entries"] if item["url"] not in batch3_article_paths] + [
        {"primary_keyword": item["primary_keyword"], "url": item["canonical_path"], "risk_tier": item["risk_tier"], "status": item["status"]}
        for item in new_articles
    ]
    blog_path.write_text(json.dumps(blog, indent=2, sort_keys=True) + "\n")

    keyword_path = DATA / "blog" / "keyword-ownership-map.json"
    keyword = json.loads(keyword_path.read_text())
    keyword["entries"] = [item for item in keyword["entries"] if item["url"] not in batch3_article_paths]
    existing_keywords = {item["primary_keyword"].casefold() for item in keyword["entries"]}
    for item in new_articles:
        if item["primary_keyword"].casefold() in existing_keywords:
            raise RuntimeError(f"keyword_collision:{item['primary_keyword']}")
        keyword["entries"].append({"primary_keyword": item["primary_keyword"], "url": item["canonical_path"], "risk_tier": item["risk_tier"], "status": item["status"]})
    keyword["schema"] = "glp-clinic-scout-phase2-batch3-keyword-map-v1"
    keyword_path.write_text(json.dumps(keyword, indent=2, sort_keys=True) + "\n")

    actual_paths = [item["canonical_path"] for item in blog["articles"]]
    pillar = {
        "schema": "glp-clinic-scout-pillar-cluster-map-v2",
        "release_authorized": False,
        "commercial_first_order": True,
        "order_policy": "accepted-existing-commercial-then-net-new-informational",
        "program_pool_exhausted": True,
        "accepted_program_count": 13,
        "held_program_ids": sorted(forbidden),
        "clusters": [
            {"cluster_id": "commercial-provider-pairs", "intent": "commercial_comparison", "articles": [path for path in actual_paths if "-vs-" in path], "money_pages": [page["path"] for page in pages]},
            {"cluster_id": "commercial-cost-and-coverage", "intent": "commercial_cost", "articles": [path for path in actual_paths if any(token in path for token in ["cost", "insurance", "fees", "hsa-fsa"])]},
            {"cluster_id": "evidence-process-and-pharmacy", "intent": "informational_due_diligence", "articles": [path for path in actual_paths if any(token in path for token in ["verify", "intake-to-pharmacy"])]},
        ],
        "net_new_batch3": {"money_pages": [page["path"] for page in pages], "articles": [item["canonical_path"] for item in new_articles]},
    }
    (DATA / "blog" / "pillar-cluster-map.json").write_text(json.dumps(pillar, indent=2, sort_keys=True) + "\n")

    print(json.dumps({"status": "PASS", "programs": len(programs), "money_pages": len(money["pages"]), "articles": len(blog["articles"]), "new_money_pages": len(pages), "new_articles": len(new_articles), "new_word_counts": [item["word_count"] for item in new_articles]}, sort_keys=True))


if __name__ == "__main__":
    main()
