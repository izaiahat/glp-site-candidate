const INTENT_ROUTES = Object.freeze({
  "compounded-semaglutide-injection": "/lp/best-providers/compounded-semaglutide/",
  "compounded-tirzepatide-injection": "/lp/best-providers/compounded-tirzepatide/",
  "brand-ozempic": "/ozempic/",
  "brand-wegovy": "/wegovy/",
  "brand-mounjaro": "/mounjaro/",
  "brand-zepbound": "/zepbound/",
});

export function resolveRetiredComparisonIntent(requestUrl) {
  const url = new URL(requestUrl);
  return INTENT_ROUTES[url.searchParams.get("drug")] || "/providers/";
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const destination = new URL(resolveRetiredComparisonIntent(url), url.origin);
  return new Response(null, {
    status: 301,
    headers: {
      location: destination.toString(),
      "cache-control": "public, max-age=300",
    },
  });
}
