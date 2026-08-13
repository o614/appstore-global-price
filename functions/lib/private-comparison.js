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
const PRICE_LADDER_TOLERANCE = 1.5;

function productIdOf(value) {
  const productId = value?.productId ?? value?.productIdentifier ?? value?.offerItemId;
  return typeof productId === "string" && productId.trim() ? productId.trim() : null;
}

function billingPeriodOf(value) {
  const raw = value?.billingPeriod ?? value?.billing_period ?? value?.recurringSubscriptionPeriod;
  if (typeof raw !== "string") return null;
  return STRUCTURED_PERIODS.get(raw.trim().toUpperCase()) ?? null;
}

function officialPeriodFromName(value) {
  const name = String(value ?? "").normalize("NFKC").toLowerCase();
  if (/annual|yearly|12\s*month|全年|年卡|年费|年付|包年/u.test(name)) return "年付";
  if (/monthly|1\s*month|月卡|月费|月付|包月/u.test(name)) return "月付";
  if (/weekly|1\s*week|7\s*day|周卡|周付/u.test(name)) return "周付";
  if (/credit|coin|gem|token|star|pack|bundle|gift|积分|金币|礼包|次卡/u.test(name)) return "一次性";
  return null;
}

function numericPrice(text) {
  let value = String(text ?? "").replace(/[^\d.,]/gu, "");
  if (!value) return null;
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./gu : /,/gu;
    value = value.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals === 2 ? value.replace(",", ".") : value.replace(/,/gu, "");
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    if (decimals !== 2) value = value.replace(/\./gu, "");
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function rankedItems(items) {
  const ranked = items.map((item) => ({ item, amount: numericPrice(item.price) }));
  if (ranked.some(({ amount }) => amount === null)) return null;
  ranked.sort((left, right) => left.amount - right.amount);
  if (ranked.some(({ amount }, index) => index > 0 && amount === ranked[index - 1].amount)) return null;
  return ranked;
}

function laddersAreCompatible(anchorRanked, regionRanked) {
  if (anchorRanked.length !== regionRanked.length || anchorRanked.length < 2) return false;
  for (let index = 1; index < anchorRanked.length; index += 1) {
    const anchorRatio = anchorRanked[index].amount / anchorRanked[index - 1].amount;
    const regionRatio = regionRanked[index].amount / regionRanked[index - 1].amount;
    const relative = regionRatio / anchorRatio;
    if (!Number.isFinite(relative) || relative < 1 / PRICE_LADDER_TOLERANCE || relative > PRICE_LADDER_TOLERANCE) {
      return false;
    }
  }
  return true;
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
    if (matches.length > 1) return rankedItems(matches)?.[plan.occurrence ?? 0]?.item ?? null;
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

function normalizeAmbiguousLabels(plans, usRegion) {
  return plans.map((plan) => {
    if (productIdOf(plan) || plan.matchPeriod) return plan;
    const alias = (plan.aliases ?? []).find((candidate) => matchingItems(usRegion, candidate).length > 1);
    if (!alias) return plan;
    return {
      ...plan,
      label: `${alias} #${(plan.occurrence ?? 0) + 1}`,
      period: "公开项目",
    };
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
    return {
      item: (region.items ?? []).find((item) => productIdOf(item) === productId) ?? null,
      method: "product-id",
    };
  }

  if (plan.matchPeriod) {
    const periodMatches = (region.items ?? []).filter((item) => billingPeriodOf(item) === plan.matchPeriod);
    if (periodMatches.length === 1) return { item: periodMatches[0], method: "billing-period" };
    if (periodMatches.length > 1) {
      return { item: null, issue: matchIssue(plan, region, "duplicate-billing-period") };
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
    const anchorRanked = rankedItems(anchorMatches);
    const regionRanked = rankedItems(regionMatches);
    if (!anchorRanked || !regionRanked) {
      return { item: null, issue: matchIssue(plan, region, "ambiguous-price-rank") };
    }
    if (!laddersAreCompatible(anchorRanked, regionRanked)) {
      return { item: null, issue: matchIssue(plan, region, "price-ladder-mismatch") };
    }
    return {
      item: regionRanked[plan.occurrence ?? 0]?.item ?? null,
      method: "name-price-rank",
    };
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
    usRegion,
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
