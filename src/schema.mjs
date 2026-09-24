import { isNonPublicSourceUrl } from "./citation-attribution.mjs";

function verifiedHuman(profile) {
  return Boolean(profile && profile.status === "verified_human" && profile.id && profile.display_name && profile.bio_path && profile.clinical_credentials_claimed === false);
}

function verifiedOrganization(profile) {
  return Boolean(
    profile &&
    profile.status === "verified_organization" &&
    profile.id &&
    profile.display_name &&
    profile.bio_path &&
    profile.clinical_credentials_claimed === false,
  );
}

function verifiedReviewer(profile) {
  return Boolean(
    profile &&
    profile.status === "verified_credentialed_reviewer" &&
    profile.id &&
    profile.display_name &&
    profile.bio_path &&
    Array.isArray(profile.credentials) &&
    profile.credentials.length > 0 &&
    profile.reviewed_at &&
    /^[a-f0-9]{64}$/.test(profile.reviewed_content_sha256 || ""),
  );
}

export function buildSchemaGraph({
  url,
  title,
  description,
  datePublished,
  dateModified,
  author,
  reviewer,
  evidenceReview,
  // Phase-4 gate remediation 2026-08-27 (GATES-PRELIM issue #6): `image` is
  // required for Article rich-result eligibility. Callers pass the absolute URL
  // of the page's EXISTING hero derivative (largest JPG for compatibility) —
  // never an invented asset.
  image = null,
  faqs = [],
  breadcrumbs = [],
  rankedItems = [],
}) {
  const humanAuthor = verifiedHuman(author);
  const organizationAuthor = verifiedOrganization(author);
  const authorReady = humanAuthor || organizationAuthor;
  const reviewerReady = verifiedReviewer(reviewer);
  const evidenceReady = Boolean(
    evidenceReview?.status === "PASS" &&
    Array.isArray(evidenceReview.source_urls) &&
    evidenceReview.source_urls.length > 0 &&
    evidenceReview.source_urls.every((sourceUrl) => /^https:\/\//.test(sourceUrl)),
  );
  const articleId = `${url}#article`;
  const medicalId = `${url}#medical-web-page`;
  const article = {
    "@type": "Article",
    "@id": articleId,
    headline: title,
    description,
    url,
    datePublished,
    dateModified,
  };
  if (image) article.image = image;
  const medicalReady = evidenceReady && reviewerReady;
  const medical = medicalReady ? {
    "@type": "MedicalWebPage",
    "@id": medicalId,
    url,
    name: title,
    mainEntity: { "@id": articleId },
    dateModified,
  } : null;
  const graph = [article];
  if (medical) graph.push(medical);
  if (authorReady) {
    const fragment = humanAuthor ? "person" : "organization";
    const id = `${new URL(author.bio_path, url).toString()}#${fragment}`;
    article.author = { "@id": id };
    if (medical) medical.author = { "@id": id };
    graph.push({
      "@type": humanAuthor ? "Person" : "Organization",
      "@id": id,
      name: author.display_name,
      url: new URL(author.bio_path, url).toString(),
      description: author.role,
      sameAs: author.same_as || [],
    });
  }
  if (evidenceReady) {
    // A partner-portal source is real evidence but is NOT publicly resolvable,
    // and its URL carries our publisher account id. It stays named and dated in
    // the visible source ledger; it never ships as a machine-readable citation.
    const publicCitations = evidenceReview.source_urls.filter((source) => !isNonPublicSourceUrl(source));
    if (publicCitations.length) {
      article.citation = publicCitations;
      if (medical) medical.citation = publicCitations;
    }
  }
  if (reviewerReady) {
    const id = `${new URL(reviewer.bio_path, url).toString()}#person`;
    article.reviewedBy = { "@id": id };
    if (medical) medical.reviewedBy = { "@id": id };
    graph.push({
      "@type": "Person",
      "@id": id,
      name: reviewer.display_name,
      url: new URL(reviewer.bio_path, url).toString(),
      jobTitle: reviewer.role,
      hasCredential: reviewer.credentials.map((credential) => ({ "@type": "EducationalOccupationalCredential", credentialCategory: credential })),
      sameAs: reviewer.same_as || [],
    });
  }
  if (faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faqs.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }
  if (breadcrumbs.length > 0) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumbs`,
      itemListElement: breadcrumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: new URL(item.path, url).toString(),
      })),
    });
  }
  if (rankedItems.length > 0) {
    const positions = rankedItems.map((item) => item.position);
    if (rankedItems.some((item) => !Number.isInteger(item.position) || item.position < 1 || !item.name || !item.path) || new Set(positions).size !== positions.length) {
      throw new Error("item_list_contract_invalid");
    }
    graph.push({
      "@type": "ItemList",
      "@id": `${url}#comparison-ranking`,
      name: `${title} ranking`,
      numberOfItems: rankedItems.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: rankedItems.map((item) => ({
        "@type": "ListItem",
        position: item.position,
        item: {
          "@type": "Thing",
          "@id": `${new URL(item.path, url).toString()}#provider`,
          name: item.name,
          url: new URL(item.path, url).toString(),
        },
      })),
    });
  }
  return {
    jsonLd: { "@context": "https://schema.org", "@graph": graph },
    gates: {
      author: authorReady ? "PASS" : "HELD_PENDING_HONEST_AUTHOR_AUTHORITY",
      evidenceReview: evidenceReady ? "PASS" : "HELD_PENDING_SOURCE_REVIEW",
      optionalClinicianReviewer: reviewerReady ? "PASS" : "NOT_REQUIRED_ADDENDUM_A",
      medicalWebPage: medicalReady ? "PASS" : "OMITTED_UNVERIFIED_REVIEWER",
      clinicianRequired: false,
      schemaIdentityReferencesEnabled: authorReady,
    },
  };
}