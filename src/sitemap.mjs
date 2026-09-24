export function buildSitemap(routes, lastmodByRoute = new Map()) {
  const locations = [...new Set(routes)].sort().map((route) => {
    if (!/^\/(?:[a-z0-9_-]+\/)*$/.test(route)) throw new Error(`sitemap_route_invalid:${route}`);
    const lastmod = lastmodByRoute.get(route);
    if (lastmod !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(lastmod))) throw new Error(`sitemap_lastmod_invalid:${route}`);
    return `<url><loc>https://glpclinicscout.com${route}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</urlset>\n`;
}
