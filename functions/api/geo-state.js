const stateCode = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
};

export function detectRequestState(request) {
  const country = String(request.cf?.country || request.headers.get("cf-ipcountry") || "").toUpperCase();
  if (country && country !== "US") return null;
  return stateCode(request.cf?.regionCode)
    || stateCode(request.headers.get("cf-region-code"))
    || null;
}

export function detectConsentModel(request) {
  const country = String(request.cf?.country || request.headers.get("cf-ipcountry") || "").toUpperCase();
  return country === "US" ? "us-default-on" : "prior-opt-in";
}

export async function onRequestGet({ request }) {
  if (new URL(request.url).searchParams.get("purpose") === "consent") {
    return new Response(JSON.stringify({ schema: "glp-consent-region-v1", model: detectConsentModel(request) }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
        vary: "CF-IPCountry",
      },
    });
  }
  const state = detectRequestState(request);
  return new Response(JSON.stringify({ schema: "glp-geo-state-v1", available: Boolean(state), state }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      vary: "CF-IPCountry, CF-Region-Code",
    },
  });
}
