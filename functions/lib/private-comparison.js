import { discoverPlans } from "../../app/lib/plan-discovery.mjs";
import { convertToBaseCurrency, parseLocalizedAmount } from "../../app/lib/price-conversion.mjs";

const STRUCTURED_PERIODS = new Map([
  ["MONTHLY", "月付"],
  ["P1M", "月付"],
  ["YEARLY", "年付"],
  ["ANNUAL", "年付"],
  ["P1Y", "年付"],
  ["WEEKLY", "周付"],
  ["P1W", "周付"],
]);
const PRIMARY_PERIODS = new Set(["月付", "年付", "周付"]);

function productIdOf(value) {
  const productId = value?.productId ?? value?.productIdentifier ?? value?.offerItemId;
  return typeof productId === "string" && productId.trim() ? productId.trim() : null;
}

function billingPeriodOf(value) {
  const raw = value?.billingPeriod ?? value?.billing_period ?? value?.recurringSubscriptionPeriod;
  if (typeof raw !== "string") return null;
  return STRUCTURED_PERIODS.get(raw.trim().toUpperCase()) ?? null;
}

function itemForPlan(region, plan) {
  const productId = productIdOf(plan);
  if (productId) {
    return (region.items ?? []).find((item) => productIdOf(item) === productId) ?? null;
  }
  const occurrence = plan.occurrence ?? 0;
  for (const alias of plan.aliases ?? []) {
    const matches = (region.items ?? []).filter((item) => item.name === alias);
    if (matches[occurrence]) return matches[occurrence];
  }
  return null;
}

function enrichAnchoredPlan(plan, usRegion) {
  const anchorItem = itemForPlan(usRegion, plan);
  const productId = productIdOf(plan) ?? productIdOf(anchorItem);
  const structuredPeriod = billingPeriodOf(plan) ?? billingPeriodOf(anchorItem);
  return {
    ...plan,
    ...(productId ? { productId } : {}),
    ...(structuredPeriod ? { period: structuredPeriod } : {}),
  };
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
  const anchoredPlans = discoverPlans({ ...app, regions: [usRegion] }, curatedPlans)
    .map((plan) => enrichAnchoredPlan(plan, usRegion));
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
    const productId = productIdOf(plan);
    const period = billingPeriodOf(plan) ?? plan.period;
    return {
      id: plan.id,
      label: plan.label,
      period,
      group: plan.displayGroup === "primary" || PRIMARY_PERIODS.has(period) ? "primary" : "other",
      matchMethod: productId ? "product-id" : "name-occurrence",
      ...(productId ? { productId } : {}),
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
