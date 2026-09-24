export async function onRequest(context) {
  const response = await context.next();
  if (!new URL(context.request.url).search) return response;

  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, follow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
