import { publicProviderName } from "./public-provider-names.mjs";
import programRegistry from "../data/program-registry.json" with { type: "json" };
import pharmacyRegistry from "../data/phase3-pharmacy-render-input.json" with { type: "json" };
import { canonicalContactStatements } from "./canonical-contact.mjs";

const LEGACY_ALLOWED_KEYS = new Set([
  "subject_name",
  "experience_type",
  "rating",
  "headline",
  "review",
  "first_name",
  "email",
  "occurred_month",
  "truthful_attestation",
  "moderation_consent",
  "company",
  "evidence",
]);
const INTAKE_ALLOWED_KEYS = new Set([
  "schema_version",
  "public_display_name",
  "verification_email",
  "primary",
  "counterpart",
  "truthful_attestation",
  "privacy_attestation",
  "moderation_consent",
  "company",
]);
const REVIEW_ITEM_KEYS = new Set([
  "entity_name",
  "entity_type",
  "product",
  "rating",
  "review_type",
  "headline",
  "review_body",
  "experience_date",
  "evidence",
  "entity_registration",
]);
// "registered" (default) = the name must match a governed registry entity of the
// declared type, exactly as before. "proposed" = an EXPLICIT user affordance
// ("Add as a new provider/pharmacy") for entities the registry does not cover
// yet; the name is length-bound and screened like public text, the submission
// stays held for manual moderation, and the proposed state is flagged in
// moderation_notes so a moderator verifies the entity before any use.
const ENTITY_REGISTRATIONS = new Set(["registered", "proposed"]);
const EVIDENCE_KEYS = new Set(["file_name", "mime_type", "size_bytes", "sha256", "base64"]);
const EXPERIENCE_TYPES = new Set(["provider", "pharmacy"]);
const PRODUCTS = new Set([
  "compounded_semaglutide",
  "compounded_tirzepatide",
  "ozempic",
  "wegovy",
  "wegovy_pill",
  "mounjaro",
  "zepbound",
  "other_or_unsure",
]);
const REVIEW_TYPES = new Set([
  "overall_experience",
  "billing_and_cost",
  "service_and_support",
  "fulfillment",
  "other",
]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const FORBIDDEN_IDENTIFIER = /\b(?:social security|ssn|date of birth|dob|medical record(?: number)?|prescription number|rx number|patient id|member id|insurance id|policy number|group number|card number|cvv|cvc)\b|\b\d{3}-\d{2}-\d{4}\b/i;
const FORBIDDEN_PRIVATE_HEALTH = /\b(?:my\s+(?:diagnosis|medical history|a1c|blood glucose|blood sugar|dose|dosage|prescription)|diagnosed\s+with|i\s+(?:take|was prescribed)|patient\s+(?:id|number)|member\s+(?:id|number)|insurance\s+(?:id|number|policy|member|group)|prescription\s+(?:id|number)|rx\s*(?:id|number|#)|medical record\s*(?:id|number))\b/i;
const POTENTIAL_CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/;
const EVIDENCE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const EVIDENCE_EXTENSIONS = new Map([
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/webp", new Set([".webp"])],
  ["application/pdf", new Set([".pdf"])],
]);
export const MAX_REVIEW_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const EVIDENCE_CHUNK_CHARACTERS = 256 * 1024;
const REVIEW_VERIFICATION_COPY_SHA256 = "bf7427bcea387ffec2765338234e37305ff22a288c856295b11720f26ddd512c";
const SUBJECT_ENTITIES = new Map();
for (const row of programRegistry.programs || []) {
  const isAlias = row?.profiles?.["glp-clinic-scout"]?.canonical_identity?.role === "alias";
  if (!isAlias && /^\/reviews\/[a-z0-9-]+\/$/.test(row?.review_path || "")) SUBJECT_ENTITIES.set(publicProviderName(row.display_name), "provider");
}
for (const row of pharmacyRegistry.entries || []) {
  if (SUBJECT_ENTITIES.has(row.display_name) && SUBJECT_ENTITIES.get(row.display_name) !== "pharmacy") throw new Error(`review_entity_name_ambiguous:${row.display_name}`);
  SUBJECT_ENTITIES.set(row.display_name, "pharmacy");
}

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const fail = (reason) => { throw new Error(reason); };
const booleanField = (value) => value === true || ["1", "true", "on", "yes"].includes(clean(value).toLowerCase());

export function governedReviewEntityCounts() {
  const values = [...SUBJECT_ENTITIES.values()];
  return Object.freeze({
    provider: values.filter((type) => type === "provider").length,
    pharmacy: values.filter((type) => type === "pharmacy").length,
    total: values.length,
  });
}

function rejectSensitivePublicText(value) {
  if (FORBIDDEN_IDENTIFIER.test(value) || FORBIDDEN_PRIVATE_HEALTH.test(value) || POTENTIAL_CARD_NUMBER.test(value)) {
    fail("sensitive_private_detail_rejected");
  }
}

function decodeEvidenceBase64(value) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_REVIEW_EVIDENCE_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("evidence_base64_invalid");
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    fail("evidence_base64_invalid");
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const windowSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += windowSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + windowSize, bytes.length)));
  }
  return btoa(binary);
}

function digestHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function evidenceSignatureMatches(mimeType, bytes) {
  if (mimeType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (mimeType === "application/pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  return false;
}

function validateEvidence(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("evidence_invalid");
  if (Object.keys(value).some((key) => !EVIDENCE_KEYS.has(key))) fail("evidence_key_not_allowed");
  const fileName = clean(value.file_name);
  const mimeType = clean(value.mime_type).toLowerCase();
  const sizeBytes = Number(value.size_bytes);
  const suppliedSha256 = clean(value.sha256).toLowerCase();
  if (!fileName || fileName.length > 120 || /[\\/\x00-\x1f]/.test(fileName)) fail("evidence_file_name_invalid");
  if (!EVIDENCE_MIME.has(mimeType)) fail("evidence_mime_invalid");
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!EVIDENCE_EXTENSIONS.get(mimeType)?.has(extension)) fail("evidence_extension_mismatch");
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_REVIEW_EVIDENCE_BYTES) fail("evidence_size_invalid");
  if (!/^[a-f0-9]{64}$/.test(suppliedSha256)) fail("evidence_sha256_invalid");
  const bytes = decodeEvidenceBase64(value.base64);
  if (bytes.byteLength !== sizeBytes) fail("evidence_size_mismatch");
  if (!evidenceSignatureMatches(mimeType, bytes)) fail("evidence_signature_invalid");
  return { fileName, mimeType, sizeBytes, suppliedSha256, base64: value.base64, bytes };
}

function validateLegacySubmission(payload, now) {
  if (Object.keys(payload).some((key) => !LEGACY_ALLOWED_KEYS.has(key))) fail("payload_key_not_allowed");
  if (clean(payload.company)) fail("bot_rejected");
  const subjectName = clean(payload.subject_name);
  const experienceType = clean(payload.experience_type).toLowerCase();
  const rating = Number(payload.rating);
  const headline = clean(payload.headline);
  const review = clean(payload.review);
  const firstName = clean(payload.first_name);
  const email = clean(payload.email).toLowerCase();
  const occurredMonth = clean(payload.occurred_month);
  if (subjectName.length < 2 || subjectName.length > 120) fail("subject_name_invalid");
  if (!EXPERIENCE_TYPES.has(experienceType)) fail("experience_type_invalid");
  if (SUBJECT_ENTITIES.get(subjectName) !== experienceType) fail("subject_entity_mismatch");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("rating_invalid");
  if (headline.length < 8 || headline.length > 120) fail("headline_invalid");
  if (review.length < 50 || review.length > 2000) fail("review_invalid");
  if (FORBIDDEN_IDENTIFIER.test(`${headline} ${review}`) || FORBIDDEN_PRIVATE_HEALTH.test(`${headline} ${review}`) || POTENTIAL_CARD_NUMBER.test(`${headline} ${review}`)) fail("sensitive_identifier_rejected");
  if (firstName.length < 1 || firstName.length > 60) fail("first_name_invalid");
  if (!EMAIL.test(email) || email.length > 254) fail("email_invalid");
  if (!MONTH.test(occurredMonth)) fail("occurred_month_invalid");
  const currentMonth = now.toISOString().slice(0, 7);
  if (occurredMonth > currentMonth) fail("occurred_month_future");
  if (payload.truthful_attestation !== true) fail("truthful_attestation_required");
  if (payload.moderation_consent !== true) fail("moderation_consent_required");
  return { schemaVersion: "legacy_v1", subjectName, experienceType, rating, headline, review, firstName, email, occurredMonth, evidence: validateEvidence(payload.evidence) };
}

function validateReviewItem(value, role, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${role}_review_invalid`);
  if (Object.keys(value).some((key) => !REVIEW_ITEM_KEYS.has(key))) fail(`${role}_key_not_allowed`);
  const entityName = clean(value.entity_name);
  const entityType = clean(value.entity_type).toLowerCase();
  const product = clean(value.product).toLowerCase();
  const rating = Number(value.rating);
  const reviewType = clean(value.review_type).toLowerCase();
  const headline = clean(value.headline);
  const reviewBody = clean(value.review_body);
  const experienceDate = clean(value.experience_date);
  const entityRegistration = clean(value.entity_registration).toLowerCase() || "registered";
  if (!ENTITY_REGISTRATIONS.has(entityRegistration)) fail(`${role}_entity_registration_invalid`);
  if (entityName.length < 2 || entityName.length > 120) fail(`${role}_entity_name_invalid`);
  if (!EXPERIENCE_TYPES.has(entityType)) fail(`${role}_entity_type_invalid`);
  const registeredType = SUBJECT_ENTITIES.get(entityName);
  if (registeredType) {
    // Known names always resolve against the registry; a "proposed" flag can
    // never bypass the exact-type match for a governed entity.
    if (registeredType !== entityType) fail(`${role}_entity_mismatch`);
  } else if (entityRegistration !== "proposed") {
    fail(`${role}_entity_mismatch`);
  } else {
    rejectSensitivePublicText(entityName);
  }
  if (!PRODUCTS.has(product)) fail(`${role}_product_invalid`);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(`${role}_rating_invalid`);
  if (!REVIEW_TYPES.has(reviewType)) fail(`${role}_review_type_invalid`);
  if (headline.length < 8 || headline.length > 120) fail(`${role}_headline_invalid`);
  if (reviewBody.length < 50 || reviewBody.length > 2000) fail(`${role}_review_body_invalid`);
  rejectSensitivePublicText(`${headline} ${reviewBody}`);
  if (!DATE.test(experienceDate) || Number.isNaN(Date.parse(`${experienceDate}T00:00:00Z`))) fail(`${role}_experience_date_invalid`);
  if (experienceDate > now.toISOString().slice(0, 10)) fail(`${role}_experience_date_future`);
  return {
    entityName,
    entityType,
    product,
    rating,
    reviewType,
    headline,
    reviewBody,
    experienceDate,
    entityRegistration: registeredType ? "registered" : "proposed",
    evidence: validateEvidence(value.evidence),
  };
}

function validateIntakeSubmission(payload, now) {
  if (Object.keys(payload).some((key) => !INTAKE_ALLOWED_KEYS.has(key))) fail("payload_key_not_allowed");
  if (payload.schema_version !== "review_intake_v2") fail("schema_version_invalid");
  if (clean(payload.company)) fail("bot_rejected");
  const publicDisplayName = clean(payload.public_display_name);
  const verificationEmail = clean(payload.verification_email).toLowerCase();
  if (publicDisplayName.length < 1 || publicDisplayName.length > 60) fail("public_display_name_invalid");
  rejectSensitivePublicText(publicDisplayName);
  if (!EMAIL.test(verificationEmail) || verificationEmail.length > 254) fail("verification_email_invalid");
  if (payload.truthful_attestation !== true) fail("truthful_attestation_required");
  if (payload.privacy_attestation !== true) fail("privacy_attestation_required");
  if (payload.moderation_consent !== true) fail("moderation_consent_required");
  const primary = validateReviewItem(payload.primary, "primary", now);
  const counterpart = payload.counterpart === undefined || payload.counterpart === null ? null : validateReviewItem(payload.counterpart, "counterpart", now);
  if (counterpart && counterpart.entityType === primary.entityType) fail("counterpart_must_be_opposite_entity_type");
  const evidenceBytes = (primary.evidence?.sizeBytes || 0) + (counterpart?.evidence?.sizeBytes || 0);
  if (evidenceBytes > MAX_REVIEW_EVIDENCE_BYTES) fail("evidence_total_size_invalid");
  return {
    schemaVersion: "review_intake_v2",
    publicDisplayName,
    verificationEmail,
    primary,
    counterpart,
    truthfulAttestation: true,
    privacyAttestation: true,
    moderationConsent: true,
  };
}

export function validateReviewSubmission(payload, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("payload_invalid");
  if (payload.schema_version === "review_intake_v2" || Object.hasOwn(payload, "primary")) return validateIntakeSubmission(payload, now);
  return validateLegacySubmission(payload, now);
}

async function evidenceFromFormFile(value) {
  if (!value || typeof value.arrayBuffer !== "function" || !Number(value.size)) return undefined;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const sha256 = digestHex(await crypto.subtle.digest("SHA-256", bytes));
  return {
    file_name: clean(value.name),
    mime_type: clean(value.type).toLowerCase(),
    size_bytes: bytes.byteLength,
    sha256,
    base64: bytesToBase64(bytes),
  };
}

function formString(form, key) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function itemFromForm(form, prefix) {
  const primary = prefix === "primary";
  const evidence = await evidenceFromFormFile(form.get(primary ? "evidence" : `${prefix}_evidence`));
  const registration = formString(form, primary ? "entity_registration" : `${prefix}_entity_registration`);
  const values = {
    entity_name: formString(form, primary ? "subject_name" : `${prefix}_entity_name`),
    entity_type: formString(form, primary ? "experience_type" : `${prefix}_entity_type`),
    product: formString(form, `${prefix}_product`),
    rating: formString(form, primary ? "rating" : `${prefix}_rating`),
    review_type: formString(form, `${prefix}_review_type`),
    headline: formString(form, `${prefix}_headline`),
    review_body: formString(form, `${prefix}_review_body`),
    experience_date: formString(form, `${prefix}_experience_date`),
    ...(evidence ? { evidence } : {}),
  };
  if (prefix === "counterpart" && !evidence && Object.values(values).every((value) => clean(value) === "")) return null;
  if (clean(registration)) values.entity_registration = registration;
  return values;
}

async function payloadFromForm(request) {
  const form = await request.formData();
  // The intake surface renders ONE checkbox whose label carries all three
  // attestation substances (truthful own experience + PHI removed + moderation
  // hold/contact consent). Checking it asserts all three; every attestation is
  // still individually required by validateIntakeSubmission, so nothing is
  // weakened — the surface is compressed, not the contract. Individual fields
  // keep working for older markup.
  const combinedAttestation = booleanField(formString(form, "combined_attestation"));
  return {
    schema_version: formString(form, "schema_version") || "review_intake_v2",
    public_display_name: formString(form, "public_display_name"),
    verification_email: formString(form, "verification_email"),
    primary: await itemFromForm(form, "primary"),
    counterpart: await itemFromForm(form, "counterpart"),
    truthful_attestation: booleanField(formString(form, "truthful_attestation")) || combinedAttestation,
    privacy_attestation: booleanField(formString(form, "privacy_attestation")) || combinedAttestation,
    moderation_consent: booleanField(formString(form, "moderation_consent")) || combinedAttestation,
    company: formString(form, "company"),
  };
}

async function payloadFromRequest(request, mediaType) {
  if (mediaType === "application/json") {
    try { return await request.json(); }
    catch { fail("json_invalid"); }
  }
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return payloadFromForm(request);
  fail("unsupported_media_type");
}

const json = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  },
});

async function verifyEvidenceDigest(evidence) {
  if (!evidence) return true;
  const digest = await crypto.subtle.digest("SHA-256", evidence.bytes);
  return digestHex(digest) === evidence.suppliedSha256;
}

function evidenceStatements(db, reviewId, role, evidence, createdAt, tableNames) {
  if (!evidence) return [];
  const evidenceId = `evidence_${crypto.randomUUID()}`;
  const chunks = evidence.base64.match(new RegExp(`.{1,${EVIDENCE_CHUNK_CHARACTERS}}`, "g")) || [];
  const statements = [db.prepare(tableNames.insertEvidence)
    .bind(evidenceId, reviewId, ...(tableNames.withRole ? [role] : []), evidence.fileName, evidence.mimeType, evidence.sizeBytes, evidence.suppliedSha256, chunks.length, createdAt)];
  chunks.forEach((chunk, index) => statements.push(db.prepare(tableNames.insertChunk).bind(evidenceId, index, chunk)));
  return statements;
}

function legacyStatements(db, reviewId, submission, createdAt) {
  const statements = [db.prepare("INSERT INTO review_submissions (review_id, subject_name, experience_type, rating, headline, review_body, first_name, verification_email, occurred_month, truthful_attestation, moderation_consent, moderation_status, publish_approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'held_manual_review', 0, ?, ?)")
    .bind(reviewId, submission.subjectName, submission.experienceType, submission.rating, submission.headline, submission.review, submission.firstName, submission.email, submission.occurredMonth, createdAt, createdAt)];
  statements.push(...evidenceStatements(db, reviewId, "primary", submission.evidence, createdAt, {
    withRole: false,
    insertEvidence: "INSERT INTO review_evidence (evidence_id, review_id, file_name, mime_type, size_bytes, sha256, chunk_count, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'held_manual_review', ?)",
    insertChunk: "INSERT INTO review_evidence_chunks (evidence_id, chunk_index, body_base64) VALUES (?, ?, ?)",
  }));
  return statements;
}

function intakeStatements(db, reviewId, submission, createdAt) {
  const primary = submission.primary;
  const counterpart = submission.counterpart;
  // Proposed-new entities are flagged into moderation_notes so the moderator
  // verifies the entity itself (not just the review) before any use.
  const proposedRoles = [
    primary.entityRegistration === "proposed" ? "primary" : null,
    counterpart?.entityRegistration === "proposed" ? "counterpart" : null,
  ].filter(Boolean);
  const moderationNotes = proposedRoles.length ? `entity_not_in_registry:${proposedRoles.join(",")}` : null;
  const statements = [db.prepare("INSERT INTO review_intake_submissions (review_id, public_display_name, verification_email, primary_entity_name, primary_entity_type, primary_product, primary_rating, primary_review_type, primary_headline, primary_review_body, primary_experience_date, counterpart_entity_name, counterpart_entity_type, counterpart_product, counterpart_rating, counterpart_review_type, counterpart_headline, counterpart_review_body, counterpart_experience_date, truthful_attestation, privacy_attestation, moderation_consent, moderation_notes, moderation_status, publish_approved, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 'held_manual_review', 0, ?, ?)")
    .bind(
      reviewId,
      submission.publicDisplayName,
      submission.verificationEmail,
      primary.entityName,
      primary.entityType,
      primary.product,
      primary.rating,
      primary.reviewType,
      primary.headline,
      primary.reviewBody,
      primary.experienceDate,
      counterpart?.entityName ?? null,
      counterpart?.entityType ?? null,
      counterpart?.product ?? null,
      counterpart?.rating ?? null,
      counterpart?.reviewType ?? null,
      counterpart?.headline ?? null,
      counterpart?.reviewBody ?? null,
      counterpart?.experienceDate ?? null,
      moderationNotes,
      createdAt,
      createdAt,
    )];
  const tableNames = {
    withRole: true,
    insertEvidence: "INSERT INTO review_intake_evidence (evidence_id, review_id, review_role, file_name, mime_type, size_bytes, sha256, chunk_count, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'held_manual_review', ?)",
    insertChunk: "INSERT INTO review_intake_evidence_chunks (evidence_id, chunk_index, body_base64) VALUES (?, ?, ?)",
  };
  statements.push(...evidenceStatements(db, reviewId, "primary", primary.evidence, createdAt, tableNames));
  statements.push(...evidenceStatements(db, reviewId, "counterpart", counterpart?.evidence, createdAt, tableNames));
  return statements;
}

export async function handleReviewCaptureRequest(request, env = {}) {
  if (request.method !== "POST") return json({ status: "METHOD_NOT_ALLOWED" }, 405);
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (!["application/json", "multipart/form-data", "application/x-www-form-urlencoded"].includes(mediaType)) return json({ status: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return json({ status: "PAYLOAD_TOO_LARGE" }, 413);
  const db = env.REVIEWS_DB || env.GLP_DB;
  if (!["local_test", "enabled"].includes(env.REVIEW_CAPTURE_MODE) || !db?.prepare) {
    return json({ status: "REVIEW_CAPTURE_HELD" }, 503);
  }
  let submission;
  try { submission = validateReviewSubmission(await payloadFromRequest(request, mediaType)); }
  catch (error) { return json({ status: "INVALID", reason: error.message }, 422); }
  const evidence = submission.schemaVersion === "review_intake_v2"
    ? [submission.primary.evidence, submission.counterpart?.evidence].filter(Boolean)
    : [submission.evidence].filter(Boolean);
  for (const item of evidence) {
    if (!await verifyEvidenceDigest(item)) return json({ status: "INVALID", reason: "evidence_sha256_mismatch" }, 422);
  }
  if (submission.schemaVersion === "review_intake_v2" && typeof db.batch !== "function") {
    return json({ status: "REVIEW_CAPTURE_HELD" }, 503);
  }
  const reviewId = `review_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const statements = submission.schemaVersion === "review_intake_v2"
    ? intakeStatements(db, reviewId, submission, createdAt)
    : legacyStatements(db, reviewId, submission, createdAt);
  statements.push(...canonicalContactStatements(db, {
    email: submission.schemaVersion === "review_intake_v2" ? submission.verificationEmail : submission.email,
    firstName: submission.schemaVersion === "review_intake_v2" ? submission.publicDisplayName : submission.firstName,
    funnelStage: "review-verification",
    sourceSurface: submission.schemaVersion === "review_intake_v2" ? "reviews/submit-v2" : "reviews/submit-legacy",
    sourceContext: submission.schemaVersion === "review_intake_v2"
      ? { primary_entity: submission.primary.entityName, primary_product: submission.primary.product, counterpart_entity: submission.counterpart?.entityName || null }
      : { subject_name: submission.subjectName, experience_type: submission.experienceType },
    reviewId,
    marketingConsent: false,
    consentVersion: "review-verification-v1-20260827",
    consentSource: "/reviews/submit/",
    consentCopySha256: REVIEW_VERIFICATION_COPY_SHA256,
    idempotencyKey: `verification:${reviewId}`,
    capturedAt: createdAt,
  }));
  try {
    if (typeof db.batch === "function") await db.batch(statements);
    else for (const statement of statements) await statement.run();
  } catch {
    return json({ status: "REVIEW_CAPTURE_HELD" }, 503);
  }
  return json({
    status: "CAPTURED_HELD_MANUAL_REVIEW",
    review_id: reviewId,
    published: false,
    counterpart_received: Boolean(submission.counterpart),
    evidence_received: evidence.length > 0,
  }, 202);
}
