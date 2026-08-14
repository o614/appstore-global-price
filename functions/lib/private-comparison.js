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

function offerNameOf(value) {
  const offerName = value?.offerName;
  return typeof offerName === "string" && offerName.trim() ? offerName.trim() : null;
}

function subscriptionFamilyIdOf(value) {
  const familyId = value?.subscriptionFamilyId;
  return typeof familyId === "string" && familyId.trim() ? familyId.trim() : null;
}

function officialPeriodFromName(value) {
  const name = String(value ?? "").normalize("NFKC").toLowerCase();
  if (/annual|yearly|12\s*month|全年|年卡|年费|年付|包年/u.test(name)) return "年付";
  if (/monthly|1\s*month|月卡|月费|月付|包月/u.test(name)) return "月付";
  if (/weekly|1\s*week|7\s*day|周卡|周付/u.test(name)) return "周付";
  if (/credit|coin|gem|token|star|pack|bundle|gift|积分|金币|礼包|次卡/u.test(name)) return "一次性";
  return null;
}

function matchingItems(region, alias) {
  return (region.items ?? []).filter((item) => item.name === alias);
}

function anchorItemForPlan(usRegion, plan) {
  const productId = productIdOf(plan);
  if (productId) return (usRegion.items ?? []).find((item) => productIdOf(item) === productId) ?? null;
  const requestedPeriod = billingPeriodOf(plan);
  if (requestedPeriod) {
    const periodMatch = (usRegion.items ?? []).find((item) => billingPeriodOf(item) === requestedPeriod);
    if (periodMatch) return periodMatch;
  }
  for (const alias of plan.aliases ?? []) {
    const matches = matchingItems(usRegion, alias);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches[plan.occurrence ?? 0] ?? null;
  }
  return null;
}

function enrichAnchoredPlan(plan, usRegion) {
  const anchorItem = anchorItemForPlan(usRegion, plan);
  const productId = productIdOf(plan) ?? productIdOf(anchorItem);
  const structuredPeriod = billingPeriodOf(plan) ?? billingPeriodOf(anchorItem);
  const officialPeriod = structuredPeriod ?? officialPeriodFromName(anchorItem?.name);
  return {
    ...plan,
    period: officialPeriod ?? "公开项目",
    ...(productId ? { productId } : {}),
    ...(structuredPeriod ? { matchPeriod: structuredPeriod } : {}),
  };
}

function normalizeAmbiguousLabels(plans) {
  const keyOf = (plan) => `${plan.label}\u0000${plan.matchPeriod ?? plan.period}`;
  const totals = new Map();
  for (const plan of plans) totals.set(keyOf(plan), (totals.get(keyOf(plan)) ?? 0) + 1);
  const seen = new Map();
  return plans.map((plan) => {
    const key = keyOf(plan);
    if ((totals.get(key) ?? 0) <= 1) return plan;
    const number = (seen.get(key) ?? 0) + 1;
    seen.set(key, number);
    return { ...plan, label: `${plan.label} #${number}` };
  });
}

function matchIssue(plan, region, reason, details = {}) {
  return {
    planId: plan.id,
    planLabel: plan.label,
    region: region.region,
    reason,
    ...details,
  };
}

function itemForPlan(region, plan, usRegion) {
  const productId = productIdOf(plan);
  if (productId) {
    const anchorItem = (usRegion.items ?? []).find((item) => productIdOf(item) === productId) ?? null;
    const item = (region.items ?? []).find((candidate) => productIdOf(candidate) === productId) ?? null;
    if (!item) {
      return { item: null, issue: matchIssue(plan, region, "product-id-not-listed") };
    }
    const mismatches = [
      ["offer-name", offerNameOf(anchorItem), offerNameOf(item)],
      ["billing-period", billingPeriodOf(anchorItem), billingPeriodOf(item)],
      ["subscription-family", subscriptionFamilyIdOf(anchorItem), subscriptionFamilyIdOf(item)],
    ].filter(([, anchorValue, regionValue]) => anchorValue && regionValue && anchorValue !== regionValue);
    if (mismatches.length) {
      return {
        item: null,
        issue: matchIssue(plan, region, "product-metadata-mismatch", {
          fields: mismatches.map(([field]) => field),
        }),
      };
    }
    return {
      item,
      method: "product-id",
    };
  }

  if (plan.matchPeriod) {
    for (const alias of plan.aliases ?? []) {
      const periodMatches = matchingItems(region, alias)
        .filter((item) => billingPeriodOf(item) === plan.matchPeriod);
      if (periodMatches.length === 1) return { item: periodMatches[0], method: "exact-name-period" };
      if (periodMatches.length > 1) {
        return { item: null, issue: matchIssue(plan, region, "duplicate-name-period") };
      }
    }
  }

  for (const alias of plan.aliases ?? []) {
    const anchorMatches = matchingItems(usRegion, alias);
    const regionMatches = matchingItems(region, alias);
    if (!regionMatches.length) continue;
    if (anchorMatches.length <= 1) {
      if (regionMatches.length === 1) return { item: regionMatches[0], method: "exact-name" };
      return {
        item: null,
        issue: matchIssue(plan, region, "unexpected-duplicate-count", {
          anchorCount: anchorMatches.length,
          regionCount: regionMatches.length,
        }),
      };
    }
    if (regionMatches.length !== anchorMatches.length) {
      return {
        item: null,
        issue: matchIssue(plan, region, "duplicate-count-mismatch", {
          anchorCount: anchorMatches.length,
          regionCount: regionMatches.length,
        }),
      };
    }
    if (region.region === usRegion.region) {
      return {
        item: anchorMatches[plan.occurrence ?? 0] ?? null,
        method: "us-anchor-only",
      };
    }
    return { item: null, issue: matchIssue(plan, region, "ambiguous-duplicate-name") };
  }
  return { item: null };
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
  const anchoredPlans = normalizeAmbiguousLabels(
    discoverPlans({ ...app, regions: [usRegion] }, curatedPlans)
      .map((plan) => enrichAnchoredPlan(plan, usRegion)),
  );
  if (!anchoredPlans.length) throw new Error("us-plans-unavailable");

  const reviewIssues = [];
  const plans = anchoredPlans.map((plan) => {
    const prices = [];
    const planIssues = [];
    const methods = new Set();
    for (const row of regionRows) {
      if (!regionIsPublic(row)) continue;
      const region = regionMap.get(row.region);
      if (!region?.currency) continue;
      const matched = itemForPlan(row, plan, usRegion);
      if (matched.issue) {
        planIssues.push(matched.issue);
        reviewIssues.push(matched.issue);
        continue;
      }
      if (!matched.item) continue;
      if (matched.method) methods.add(matched.method);
      const localAmount = parseLocalizedAmount(matched.item.price, region.currency);
      const cny = convertToBaseCurrency(matched.item.price, region.currency, rates[region.currency]);
      if (localAmount === null || cny === null) {
        const issue = matchIssue(plan, row, "price-parse-failed");
        planIssues.push(issue);
        reviewIssues.push(issue);
        continue;
      }
      prices.push({
        code: region.code,
        name: region.name,
        currency: region.currency,
        price: matched.item.price,
        localAmount,
        cny: roundedCny(cny),
      });
    }
    prices.sort((left, right) => left.cny - right.cny || left.code.localeCompare(right.code));
    const productId = productIdOf(plan);
    const period = plan.matchPeriod ?? plan.period;
    return {
      id: plan.id,
      label: plan.label,
      period,
      group: plan.displayGroup === "primary" || PRIMARY_PERIODS.has(period) ? "primary" : "other",
      matchMethod: methods.size === 1 ? [...methods][0] : methods.size > 1 ? "mixed-verified" : "unmatched",
      ...(productId ? { productId } : {}),
      prices,
      availableRegionCount: prices.length,
      excludedRegionCount: new Set(planIssues.map((issue) => issue.region)).size,
    };
  });

  return {
    version: 2,
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
    review: {
      excludedMatchCount: reviewIssues.length,
      affectedRegionCount: new Set(reviewIssues.map((issue) => issue.region)).size,
      issues: reviewIssues.slice(0, 100),
    },
  };
}

export function comparisonHasUsAnchor(comparison) {
  return regionIsPublic(comparison?.app?.regions?.find((region) => region.region === "us"));
}
