// Article reviews are an additional editorial surface, never a replacement for
// an owned provider profile, held redirect, intake page or another article.
export function assertArticleReviewRoutes(articles, reservedRoutes) {
  const occupied = new Set(['/reviews/', '/reviews/submit/', ...reservedRoutes]);
  for (const article of articles) {
    const route = String(article.canonical_path || '');
    if (!route.startsWith('/reviews/')) continue;
    if (occupied.has(route)) throw new Error(`article_review_route_collision:${route}`);
    occupied.add(route);
  }
}
