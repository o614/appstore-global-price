import { discoverPlans } from "../../app/lib/plan-discovery.mjs";
import { convertToBaseCurrency, parseLocalizedAmount } from "../../app/lib/price-conversion.mjs";

function itemForPlan(region, plan) {
  const occurrence = plan.occurrence ?? 0;
  for (const alias of plan.aliases ?? []) {
    const matches = (region.items ?? []).filter((item) => item.name === alias);
    if (matches[occurrence]) return matches[occurrence];
  }
  return null;
}

function regionIsPublic(region) {
  return !String(region?.status ?? "").startsWith("error:")
    && Array.isArray(region?.items)
    && region.items.length > 0;
}

function roundedCny(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildPrivateComparison(comparison, {
  curatedPlans = [],
  exchangeRates,
  regions,
} = {}) {
  const app = comparison?.app;
  const regionRows = Array.isArray(app?.regions) ? app.regions : [];
  const usRegion = regionRows.find((region) => region.region === "us");
  if (!regionIsPublic(usRegion)) throw new Error("us-anchor-unavailable");

  const regionMap = new Map((regions ?? []).map((region) => [region.code, region]));
  const rates = exchangeRates?.rates ?? {};
  const anchoredPlans = discoverPlans({ ...app, regions: [usRegion] }, curatedPlans);
  if (!anchoredPlans.length) throw new Error("us-plans-unavailable");

  const plans = anchoredPlans.map((plan) => {
    const prices = [];
    for (const row of regionRows) {
      if (!regionIsPublic(row)) continue;
      const region = regionMap.get(row.region);
      if (!region?.currency) continue;
      const item = itemForPlan(row, plan);
      if (!item) continue;
      const localAmount = parseLocalizedAmount(item.price, region.currency);
      const cny = convertToBaseCurrency(item.price, region.currency, rates[region.currency]);
      if (localAmount === null || cny === null) continue;
      prices.push({
        code: region.code,
        name: region.name,
        currency: region.currency,
        price: item.price,
        localAmount,
        cny: roundedCny(cny),
      });
    }
    prices.sort((left, right) => left.cny - right.cny || left.code.localeCompare(right.code));
    return {
      id: plan.id,
      label: plan.label,
      period: plan.period,
      group: plan.displayGroup === "primary" ? "primary" : "other",
      prices,
      availableRegionCount: prices.length,
    };
  });

  return {
    version: 1,
    generatedAt: comparison.generatedAt,
    exchangeRateUpdatedAt: exchangeRates?.updatedAt ?? null,
    regionCount: regions?.length ?? 0,
    app: {
      id: String(app.id),
      name: app.matchedName ?? app.query ?? String(app.id),
      developer: app.developer ?? "",
      icon: app.icon ?? null,
      storeUrl: app.storeUrl ?? null,
      priceSource: app.priceSource ?? "app-store",
    },
    plans,
    primaryPlanCount: plans.filter((plan) => plan.group === "primary").length,
    otherPlanCount: plans.filter((plan) => plan.group !== "primary").length,
    degradedRegionCount: regionRows.filter((region) => String(region.status ?? "").startsWith("error:") && region.status !== "error:HTTP 404").length,
  };
}

export function comparisonHasUsAnchor(comparison) {
  return regionIsPublic(comparison?.app?.regions?.find((region) => region.region === "us"));
}
