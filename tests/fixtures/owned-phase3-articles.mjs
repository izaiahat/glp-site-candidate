// Synthetic card-template inputs only; never accepted article or release authority.
export function ownedArticles(count) {
  return Array.from({ length: count }, (_, index) => ({
    canonical_path: `/guides/lane-e-owned-guide-${index + 1}/`,
    h1: `Clinic Scout owned guide ${index + 1}`,
    meta_description: `Source-checked owned description ${index + 1}.`,
    direct_answer: `Bound editorial answer ${index + 1}.`,
    vertical: "GLP-1",
    // The owning test exercises the commercial related-card branch. Missing
    // scope deliberately defaults to medical/contextual-only in the renderer.
    surface_taxonomy: "commercial",
  }));
}
