export function parseRedirects(source) {
  const redirects = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, status = "301"] = line.split(/\s+/);
    if (!from || !to || !/^3\d\d$/.test(status)) {
      throw new Error(`Unsupported review redirect rule: ${rawLine}`);
    }
    if (from.includes("*") || from.includes(":")) {
      throw new Error(`Review server requires explicit redirect routes: ${from}`);
    }
    redirects.set(from, Object.freeze({ to, status: Number(status) }));
  }
  return redirects;
}

export function redirectLocation(destination, requestUrl) {
  const request = new URL(requestUrl);
  const target = new URL(destination, request.origin);
  if (!target.search && request.search) target.search = request.search;
  return target.toString();
}
