const CATALOG_VIEW = "top-in-app-purchasables";

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function appleCatalogAppUrl(appId, regionCode, locale = "en") {
  const url = new URL(`https://apps.apple.com/api/apps/v1/catalog/${regionCode}/apps/${appId}`);
  url.searchParams.set("platform", "web");
  url.searchParams.set("views", CATALOG_VIEW);
  url.searchParams.set("l", locale);
  return url;
}

export function extractAppleCatalog(payload, expectedAppId) {
  const app = Array.isArray(payload?.data)
    ? payload.data.find((candidate) => String(candidate?.id ?? "") === String(expectedAppId))
    : null;
  if (!app) return { status: "catalog-app-missing", items: [], metadata: null };

  const attributes = app.attributes ?? {};
  const metadata = {
    matchedName: cleanString(attributes.name),
    developer: cleanString(attributes.artistName) ?? "",
    icon: null,
    storeUrl: cleanString(attributes.url),
  };
  const rawItems = app.views?.[CATALOG_VIEW]?.data;
  if (!Array.isArray(rawItems)) {
    return { status: "catalog-iap-view-missing", items: [], metadata };
  }

  const seen = new Set();
  const items = [];
  for (const entry of rawItems) {
    const itemAttributes = entry?.attributes ?? {};
    const offer = Array.isArray(itemAttributes.offers)
      ? itemAttributes.offers.find((candidate) => candidate?.type === "buy") ?? itemAttributes.offers[0]
      : null;
    const productId = cleanString(entry?.id);
    const name = cleanString(itemAttributes.name);
    const price = cleanString(offer?.priceFormatted);
    if (!productId || !name || !price || seen.has(productId)) continue;
    seen.add(productId);
    items.push({
      name,
      price,
      productId,
      ...(cleanString(itemAttributes.offerName) ? { offerName: cleanString(itemAttributes.offerName) } : {}),
      ...(cleanString(offer?.recurringSubscriptionPeriod)
        ? { billingPeriod: cleanString(offer.recurringSubscriptionPeriod) }
        : {}),
      ...(cleanString(itemAttributes.subscriptionFamilyId)
        ? { subscriptionFamilyId: cleanString(itemAttributes.subscriptionFamilyId) }
        : {}),
      ...(typeof itemAttributes.isSubscription === "boolean"
        ? { isSubscription: itemAttributes.isSubscription }
        : {}),
    });
  }

  return {
    status: items.length ? "ok-structured" : "catalog-iap-empty",
    items,
    metadata,
  };
}
