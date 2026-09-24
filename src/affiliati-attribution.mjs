const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const AFFILIATI_OFFERS = Object.freeze([
  Object.freeze({ offer_id: "40044", provider: "Direct Meds", campaign_id: "1055694" }),
  Object.freeze({ offer_id: "42896", provider: "JRNYS", campaign_id: "1055693" }),
  Object.freeze({ offer_id: "43194", provider: "MEDVI", campaign_id: "1055692" }),
]);

const OFFERS_BY_ID = new Map(AFFILIATI_OFFERS.map((offer) => [offer.offer_id, offer]));

export function isUuidV7(value) {
  return UUID_V7.test(String(value || ""));
}

export function affiliatiOffer(offerId) {
  return OFFERS_BY_ID.get(String(offerId || "")) || null;
}
