import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import exchangeRateSnapshot from "../data/exchange-rates.json" with { type: "json" };
import planDefinitions from "../data/plan-definitions.json" with { type: "json" };
import regionSnapshot from "../data/regions.json" with { type: "json" };
import validationSnapshot from "../data/validation-snapshot.json" with { type: "json" };
import { buildPrivateComparison } from "../functions/lib/private-comparison.js";
import {
  classifyComparisonResultError,
  classifyPrivateRefreshError,
  comparisonIdentitySummary,
  onRequestPost,
  privateSearch,
  retryTransientRegions,
  retryUsAnchor,
  selectPrivateRefreshRecord,
  verifyPrivateSignature,
} from "../functions/api/apps/[[path]].js";

const regions = [
  { code: "us", name: "美国", currency: "USD" },
  { code: "ph", name: "菲律宾", currency: "PHP" },
];
const exchangeRates = {
  updatedAt: "2026-08-12T00:00:00.000Z",
  rates: { CNY: 1, USD: 0.14, PHP: 8 },
};

test("private comparison excludes duplicate names when Apple provides no structured identity", () => {
  const comparison = {
    generatedAt: "2026-08-12T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      developer: "Example Inc.",
      regions: [
        {
          region: "us",
          status: "ok-textPairs",
          items: [
            { name: "Example Plus", price: "$10.00" },
            { name: "Example Plus", price: "$100.00" },
          ],
        },
        {
          region: "ph",
          status: "ok-textPairs",
          items: [
            { name: "Example Plus", price: "₱4,000.00" },
            { name: "Example Plus", price: "₱400.00" },
          ],
        },
      ],
    },
  };
  const payload = buildPrivateComparison(comparison, {
    regions,
    exchangeRates,
    curatedPlans: [
      { id: "monthly", label: "Example Plus", period: "月付", aliases: ["Example Plus"], occurrence: 0 },
      { id: "annual", label: "Example Plus", period: "年付", aliases: ["Example Plus"], occurrence: 1 },
    ],
  });
  assert.equal(payload.plans.length, 2);
  assert.equal(payload.plans[0].label, "Example Plus #1");
  assert.equal(payload.plans[0].period, "公开项目");
  assert.deepEqual(payload.plans[0].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.plans[1].label, "Example Plus #2");
  assert.equal(payload.plans[1].prices.find((price) => price.code === "us").price, "$100.00");
  assert.equal(payload.plans[1].matchMethod, "us-anchor-only");
  assert.equal(payload.review.excludedMatchCount, 2);
  assert.ok(payload.review.issues.every((issue) => issue.reason === "ambiguous-duplicate-name"));
  assert.equal(payload.primaryPlanCount, 2);
});

test("private comparison never recovers duplicate identities from a similar price ladder", () => {
  const comparison = {
    generatedAt: "2026-08-13T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      developer: "Example Inc.",
      regions: [
        {
          region: "us",
          status: "ok-textPairs",
          items: [
            { name: "Example Plus", price: "$10.00" },
            { name: "Example Plus", price: "$100.00" },
          ],
        },
        {
          region: "ph",
          status: "ok-textPairs",
          items: [
            { name: "Example Plus", price: "₱800.00" },
            { name: "Example Plus", price: "₱900.00" },
          ],
        },
      ],
    },
  };
  const payload = buildPrivateComparison(comparison, {
    regions,
    exchangeRates,
    curatedPlans: [
      { id: "first", label: "Example Plus", period: "月付", aliases: ["Example Plus"], occurrence: 0 },
      { id: "second", label: "Example Plus", period: "年付", aliases: ["Example Plus"], occurrence: 1 },
    ],
  });

  assert.deepEqual(payload.plans[0].prices.map((price) => price.code), ["us"]);
  assert.deepEqual(payload.plans[1].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.plans[0].excludedRegionCount, 1);
  assert.equal(payload.review.affectedRegionCount, 1);
  assert.ok(payload.review.issues.every((issue) => issue.reason === "ambiguous-duplicate-name"));
});

test("private comparison does not publish a manually guessed billing period", () => {
  const payload = buildPrivateComparison({
    generatedAt: "2026-08-13T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: [{
        region: "us",
        status: "ok-textPairs",
        items: [{ name: "Example Pro", price: "$20.00" }],
      }],
    },
  }, {
    regions,
    exchangeRates,
    curatedPlans: [{ id: "pro", label: "Example Pro", period: "月付", aliases: ["Example Pro"] }],
  });

  assert.equal(payload.plans[0].period, "公开项目");
  assert.equal(payload.plans[0].label, "Example Pro");
});

test("private comparison prefers product IDs across localized names and changed ordering", () => {
  const comparison = {
    generatedAt: "2026-08-13T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      developer: "Example Inc.",
      regions: [
        {
          region: "us",
          status: "ok-structured",
          items: [
            {
              name: "Example Plus",
              price: "$10.00",
              productId: "com.example.plus.monthly",
              billingPeriod: "P1M",
            },
            {
              name: "Example Plus",
              price: "$100.00",
              productId: "com.example.plus.annual",
              billingPeriod: "P1Y",
            },
          ],
        },
        {
          region: "ph",
          status: "ok-structured",
          items: [
            {
              name: "Taunang Example Plus",
              price: "₱4,000.00",
              productId: "com.example.plus.annual",
              billingPeriod: "YEARLY",
            },
            {
              name: "Buwanang Example Plus",
              price: "₱400.00",
              productId: "com.example.plus.monthly",
              billingPeriod: "MONTHLY",
            },
          ],
        },
      ],
    },
  };
  const payload = buildPrivateComparison(comparison, {
    regions,
    exchangeRates,
    curatedPlans: [
      { id: "monthly", label: "Example Plus", period: "公开项目", aliases: ["Example Plus"], occurrence: 0 },
      { id: "annual", label: "Example Plus", period: "公开项目", aliases: ["Example Plus"], occurrence: 1 },
    ],
  });

  const monthly = payload.plans.find((plan) => plan.id === "monthly");
  const annual = payload.plans.find((plan) => plan.id === "annual");
  assert.equal(monthly.productId, "com.example.plus.monthly");
  assert.equal(monthly.period, "月付");
  assert.equal(monthly.group, "primary");
  assert.equal(monthly.matchMethod, "product-id");
  assert.equal(monthly.prices.find((price) => price.code === "ph").price, "₱400.00");
  assert.equal(annual.productId, "com.example.plus.annual");
  assert.equal(annual.period, "年付");
  assert.equal(annual.prices.find((price) => price.code === "ph").price, "₱4,000.00");
});

test("private refresh retains a reliable curated identity when Apple falls back to duplicate text labels", () => {
  const structuredComparison = {
    generatedAt: "2026-08-16T01:00:00.000Z",
    app: {
      id: "6448311069",
      matchedName: "ChatGPT",
      regions: [{
        region: "us",
        status: "ok-structured",
        items: [
          { name: "ChatGPT Plus", price: "$19.99", productId: "6448311597", billingPeriod: "P1M" },
          { name: "ChatGPT Plus", price: "$200.00", productId: "6745416289", billingPeriod: "P1Y" },
        ],
      }],
    },
  };
  const degradedComparison = {
    generatedAt: "2026-08-16T02:00:00.000Z",
    app: {
      id: "6448311069",
      matchedName: "ChatGPT",
      regions: [{
        region: "us",
        status: "ok-textPairs",
        identityStatus: "catalog-iap-view-missing",
        items: [
          { name: "ChatGPT Plus", price: "$19.99" },
          { name: "ChatGPT Plus", price: "$200.00" },
        ],
      }],
    },
  };
  const record = (comparison, diagnostics) => ({
    source: "live",
    diagnostics,
    data: buildPrivateComparison(comparison, {
      curatedPlans: planDefinitions["6448311069"],
      exchangeRates,
      regions,
    }),
  });
  const previous = record(structuredComparison, {
    usStatus: "ok-structured",
    usIdentityStatus: null,
    structuredRegionCount: 1,
  });
  const candidate = record(degradedComparison, {
    usStatus: "ok-textPairs",
    usIdentityStatus: "catalog-iap-view-missing",
    structuredRegionCount: 0,
  });

  assert.equal(comparisonIdentitySummary(candidate, "6448311069").unresolvedCuratedPlanCount, 2);
  const retained = selectPrivateRefreshRecord(previous, candidate, "6448311069");
  assert.equal(retained.action, "retain");
  assert.equal(retained.reason, "curated-identity-degraded");
  assert.equal(retained.record, previous);

  const rejected = selectPrivateRefreshRecord(null, candidate, "6448311069");
  assert.equal(rejected.action, "reject");
  assert.equal(rejected.record, null);
});

test("private refresh keeps numbered fallback projects for an uncurated app", () => {
  const comparison = {
    generatedAt: "2026-08-16T02:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Uncurated App",
      regions: [{
        region: "us",
        status: "ok-textPairs",
        identityStatus: "catalog-iap-view-missing",
        items: [
          { name: "SVIP", price: "$10.00" },
          { name: "SVIP", price: "$20.00" },
        ],
      }],
    },
  };
  const candidate = {
    source: "live",
    data: buildPrivateComparison(comparison, { regions, exchangeRates }),
  };
  const decision = selectPrivateRefreshRecord(null, candidate, "123456789");
  assert.equal(decision.action, "accept");
  assert.deepEqual(candidate.data.plans.map((plan) => plan.label), ["SVIP #1", "SVIP #2"]);
});

test("private refresh retries a US fallback when the structured identity endpoint degraded", async () => {
  const comparison = {
    generatedAt: "2026-08-16T02:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: [{
        region: "us",
        status: "ok-textPairs",
        identityStatus: "catalog-iap-view-missing",
        items: [{ name: "Example Plus", price: "$9.99" }],
      }],
    },
  };
  let requests = 0;
  const retried = await retryUsAnchor(comparison, async (input) => {
    requests += 1;
    const url = new URL(input);
    assert.equal(url.hostname, "apps.apple.com");
    assert.match(url.pathname, /\/api\/apps\/v1\/catalog\/us\/apps\/123456789/u);
    return new Response(JSON.stringify({
      data: [{
        id: "123456789",
        attributes: { name: "Example", artistName: "Example Inc." },
        views: {
          "top-in-app-purchasables": {
            data: [{
              id: "com.example.plus.monthly",
              attributes: {
                name: "Example Plus",
                offers: [{
                  type: "buy",
                  priceFormatted: "$9.99",
                  recurringSubscriptionPeriod: "P1M",
                }],
              },
            }],
          },
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, AbortSignal.timeout(1_000));

  const us = retried.app.regions.find((region) => region.region === "us");
  assert.equal(requests, 1);
  assert.equal(us.status, "ok-structured");
  assert.equal(us.items[0].productId, "com.example.plus.monthly");
  assert.equal(us.items[0].billingPeriod, "P1M");
});

test("private refresh retries several identity-only storefront degradations", async () => {
  const degradedRegions = ["mx", "nz", "ae", "sa"];
  const comparison = {
    generatedAt: "2026-08-24T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: degradedRegions.map((region) => ({
        region,
        status: "ok-textPairs",
        identityStatus: "error:HTTP 429",
        itemCount: 1,
        items: [{ name: "Example Plus", price: "$9.99" }],
      })),
    },
  };
  let requests = 0;
  const retried = await retryTransientRegions(comparison, async () => {
    requests += 1;
    return new Response(JSON.stringify({
      data: [{
        id: "123456789",
        attributes: { name: "Example", artistName: "Example Inc." },
        views: {
          "top-in-app-purchasables": {
            data: [{
              id: "com.example.plus.monthly",
              attributes: {
                name: "Example Plus",
                offers: [{
                  type: "buy",
                  priceFormatted: "$9.99",
                  recurringSubscriptionPeriod: "P1M",
                }],
              },
            }],
          },
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, AbortSignal.timeout(1_000));

  assert.equal(requests, degradedRegions.length);
  assert.ok(retried.app.regions.every((region) => region.status === "ok-structured"));
  assert.ok(retried.app.regions.every((region) => region.items[0].productId === "com.example.plus.monthly"));
});

test("private comparison never falls back to a same-name item with a different product ID", () => {
  const comparison = {
    generatedAt: "2026-08-13T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      developer: "Example Inc.",
      regions: [
        {
          region: "us",
          status: "ok-structured",
          items: [{
            name: "Example Plus",
            price: "$10.00",
            productId: "com.example.plus.monthly",
            billingPeriod: "MONTHLY",
          }],
        },
        {
          region: "ph",
          status: "ok-structured",
          items: [{
            name: "Example Plus",
            price: "₱400.00",
            productId: "com.example.different.monthly",
            billingPeriod: "MONTHLY",
          }],
        },
      ],
    },
  };
  const payload = buildPrivateComparison(comparison, {
    regions,
    exchangeRates,
    curatedPlans: [{
      id: "monthly",
      label: "Example Plus",
      period: "月付",
      aliases: ["Example Plus"],
    }],
  });

  assert.deepEqual(payload.plans[0].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.plans[0].notListedRegionCount, 1);
  assert.equal(payload.plans[0].excludedRegionCount, 0);
  assert.equal(payload.review.excludedMatchCount, 0);
});

test("private comparison still excludes an unstructured row that cannot prove the product identity", () => {
  const payload = buildPrivateComparison({
    generatedAt: "2026-08-24T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: [
        {
          region: "us",
          status: "ok-structured",
          items: [{
            name: "Example Plus",
            price: "$9.99",
            productId: "com.example.plus.monthly",
            billingPeriod: "P1M",
          }],
        },
        {
          region: "ph",
          status: "ok-textPairs",
          identityStatus: "error:HTTP 429",
          items: [{ name: "Example Plus", price: "₱499.00" }],
        },
      ],
    },
  }, { regions, exchangeRates });

  assert.deepEqual(payload.plans[0].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.plans[0].notListedRegionCount, 0);
  assert.equal(payload.plans[0].excludedRegionCount, 1);
  assert.equal(payload.review.issues[0].reason, "product-id-not-listed");
});

test("private comparison rejects conflicting metadata even when the numeric product ID matches", () => {
  const payload = buildPrivateComparison({
    generatedAt: "2026-08-14T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: [
        {
          region: "us",
          status: "ok-structured",
          items: [{
            name: "Example Plus",
            price: "$10.00",
            productId: "1363566605",
            offerName: "com.example.monthly",
            billingPeriod: "P1M",
            subscriptionFamilyId: "family-a",
          }],
        },
        {
          region: "ph",
          status: "ok-structured",
          items: [{
            name: "Example Plus",
            price: "₱400.00",
            productId: "1363566605",
            offerName: "com.example.annual",
            billingPeriod: "P1Y",
            subscriptionFamilyId: "family-b",
          }],
        },
      ],
    },
  }, { regions, exchangeRates });

  assert.deepEqual(payload.plans[0].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.plans[0].excludedRegionCount, 1);
  assert.equal(payload.review.issues[0].reason, "product-metadata-mismatch");
  assert.deepEqual(payload.review.issues[0].fields, [
    "offer-name",
    "billing-period",
    "subscription-family",
  ]);
});

test("private refresh retains the last verified record when regional identity quality regresses", () => {
  const structuredItem = {
    name: "Example Plus",
    price: "$9.99",
    productId: "com.example.plus.monthly",
    billingPeriod: "P1M",
  };
  const previousComparison = {
    generatedAt: "2026-08-24T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      regions: [
        { region: "us", status: "ok-structured", items: [structuredItem] },
        { region: "ph", status: "ok-structured", items: [{ ...structuredItem, price: "₱499.00" }] },
      ],
    },
  };
  const degradedComparison = {
    generatedAt: "2026-08-24T02:00:00.000Z",
    app: {
      ...previousComparison.app,
      regions: [
        { region: "us", status: "ok-structured", items: [structuredItem] },
        {
          region: "ph",
          status: "ok-textPairs",
          identityStatus: "error:HTTP 429",
          items: [{ name: "Example Plus", price: "₱499.00" }],
        },
      ],
    },
  };
  const makeRecord = (comparison, identityDegradedRegionCount) => ({
    source: "live",
    diagnostics: {
      usStatus: "ok-structured",
      usIdentityStatus: null,
      structuredRegionCount: 2 - identityDegradedRegionCount,
      identityDegradedRegionCount,
    },
    data: buildPrivateComparison(comparison, { regions, exchangeRates }),
  });
  const previous = makeRecord(previousComparison, 0);
  const candidate = makeRecord(degradedComparison, 1);
  const decision = selectPrivateRefreshRecord(previous, candidate, "123456789");

  assert.equal(decision.action, "retain");
  assert.equal(decision.reason, "regional-identity-degraded");
  assert.equal(decision.record, previous);
});

test("private comparison numbers but does not cross-match unclassified duplicate purchases", () => {
  const comparison = {
    generatedAt: "2026-08-13T01:00:00.000Z",
    app: {
      id: "123456789",
      matchedName: "Example",
      developer: "Example Inc.",
      regions: [
        {
          region: "us",
          status: "ok-textPairs",
          items: [
            { name: "SVIP", price: "$10.00" },
            { name: "SVIP", price: "$20.00" },
          ],
        },
        {
          region: "ph",
          status: "ok-textPairs",
          items: [
            { name: "SVIP", price: "₱400.00" },
            { name: "SVIP", price: "₱800.00" },
          ],
        },
      ],
    },
  };
  const payload = buildPrivateComparison(comparison, { regions, exchangeRates });

  assert.equal(payload.plans[0].matchMethod, "us-anchor-only");
  assert.equal(payload.plans[0].label, "SVIP #1");
  assert.equal(payload.plans[1].label, "SVIP #2");
  assert.deepEqual(payload.plans[1].prices.map((price) => price.code), ["us"]);
  assert.equal(payload.review.excludedMatchCount, 2);
});

test("private comparison can seed every numeric curated snapshot", () => {
  for (const app of validationSnapshot.apps.filter((candidate) => /^\d{6,12}$/u.test(String(candidate.id)))) {
    assert.doesNotThrow(() => buildPrivateComparison({
      generatedAt: validationSnapshot.generatedAt,
      app,
    }, {
      curatedPlans: planDefinitions[app.id] ?? [],
      exchangeRates: exchangeRateSnapshot,
      regions: regionSnapshot.regions,
    }), `failed to seed ${app.matchedName ?? app.query ?? app.id} (${app.id})`);
  }
});

test("private refresh distinguishes unavailable US data from transient failure", () => {
  assert.equal(classifyPrivateRefreshError(new Error("us-anchor-unavailable")), "no-comparable-plans");
  assert.equal(classifyPrivateRefreshError(new Error("us-plans-unavailable")), "no-comparable-plans");
  assert.equal(classifyPrivateRefreshError(new Error("HTTP 503")), "refresh-failed");
});

test("private refresh treats a missing US web IAP section as a terminal public-data limitation", () => {
  const missingUsWebIap = {
    app: {
      regions: [
        { region: "us", status: "iap-section-missing", items: [] },
        { region: "jp", status: "ok-1", items: [{ id: "example", name: "Example" }] },
      ],
    },
  };
  assert.equal(
    classifyComparisonResultError(missingUsWebIap, new Error("us-anchor-unavailable")),
    "web-iap-not-public",
  );
  assert.equal(
    classifyComparisonResultError({
      app: { regions: [{ region: "us", status: "error:请求 Apple 超时", items: [] }] },
    }, new Error("us-anchor-unavailable")),
    "refresh-failed",
  );
});

test("private name search trusts Apple's first US result and skips candidate selection", async () => {
  const values = new Map();
  const requestedHosts = [];
  const storage = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
  };
  const payload = await privateSearch("Sky Guide", storage, async (input) => {
    const url = new URL(input);
    requestedHosts.push(url.hostname);
    if (url.hostname === "apps.apple.com") return new Response("", { status: 200 });
    assert.equal(url.hostname, "itunes.apple.com");
    assert.equal(url.searchParams.get("country"), "us");
    assert.equal(url.searchParams.get("limit"), "1");
    return new Response(JSON.stringify({
      results: [
        {
          trackId: 576588894,
          trackName: "Sky Guide",
          sellerName: "Fifth Star Labs LLC",
          trackViewUrl: "https://apps.apple.com/us/app/id576588894",
        },
        {
          trackId: 123456789,
          trackName: "Unrelated result",
          sellerName: "Other developer",
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.equal(payload.cache, "miss");
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].appId, "576588894");
  assert.equal(payload.results[0].appName, "Sky Guide");
  assert.deepEqual(requestedHosts.sort(), ["apps.apple.com", "itunes.apple.com"]);
  assert.ok(values.has("private:search:v2:skyguide"));
});

test("private name search only caches an empty transient result for one minute", async () => {
  const writes = [];
  const storage = {
    get: async () => null,
    put: async (key, value, options) => writes.push({ key, value, options }),
  };
  const payload = await privateSearch("Temporary Missing App", storage, async () => (
    new Response("", { status: 503 })
  ));

  assert.deepEqual(payload.results, []);
  assert.equal(writes[0].options.expirationTtl, 60);
});

test("private signature verifies the exact method, path and body", async () => {
  const secret = "unit-test-secret";
  const timestamp = "1786500000";
  const body = JSON.stringify({ query: "ChatGPT" });
  const pathname = "/api/apps/private/search";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const request = new Request(`https://price.example${pathname}`, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-price-timestamp": timestamp,
      "x-price-signature": signature,
    },
  });
  assert.equal(
    await verifyPrivateSignature(request, new URL(request.url), body, secret, Number(timestamp)),
    true,
  );
  assert.equal(
    await verifyPrivateSignature(request, new URL(request.url), `${body} `, secret, Number(timestamp)),
    false,
  );
});

test("private v1 health endpoint requires signing and configured storage", async () => {
  const secret = "health-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = "{}";
  const pathname = "/api/apps/private/v1/health";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "v1", "health"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
      },
    },
    waitUntil: () => undefined,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, 1);
});

test("private legacy health route remains available during v1 migration", async () => {
  const secret = "legacy-health-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = "{}";
  const pathname = "/api/apps/private/health";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "health"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async () => null,
        put: async () => undefined,
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).apiVersion, 1);
});

test("private endpoints reject unsigned and oversized requests before doing work", async () => {
  const unsigned = await onRequestPost({
    request: new Request("https://price.example/api/apps/private/search", {
      method: "POST",
      body: JSON.stringify({ query: "ChatGPT" }),
    }),
    params: { path: ["private", "search"] },
    env: { PRICE_COMPARE_API_SECRET: "secret" },
  });
  assert.equal(unsigned.status, 401);

  const oversized = await onRequestPost({
    request: new Request("https://price.example/api/apps/private/search", {
      method: "POST",
      body: "x".repeat(4_097),
    }),
    params: { path: ["private", "search"] },
    env: { PRICE_COMPARE_API_SECRET: "secret" },
  });
  assert.equal(oversized.status, 413);
});

test("private compare refreshes a curated snapshot that lacks product identities", async () => {
  const secret = "compare-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "6448311069" });
  const pathname = "/api/apps/private/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const values = new Map();
  const generatedAt = new Date().toISOString();
  const app = validationSnapshot.apps.find((candidate) => candidate.id === "6448311069");
  values.set("private:compare:v7:6448311069", JSON.stringify({
    storedAt: generatedAt,
    source: "snapshot",
    data: buildPrivateComparison({ generatedAt, app }, {
      curatedPlans: planDefinitions[app.id] ?? [],
      exchangeRates: exchangeRateSnapshot,
      regions: regionSnapshot.regions,
    }),
  }));
  values.set("private:lock:v1:6448311069", "already-refreshing");
  let backgroundStarted = false;
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: () => { backgroundStarted = true; },
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.status, "pending");
  assert.equal(payload.retryAfter, 30);
  assert.equal(backgroundStarted, true);
});

test("private v1 compare serves structured monthly and annual identities immediately", async () => {
  const secret = "structured-compare-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "6448311069" });
  const pathname = "/api/apps/private/v1/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const generatedAt = new Date().toISOString();
  const structuredComparison = {
    generatedAt,
    app: {
      id: "6448311069",
      matchedName: "ChatGPT",
      regions: [
        {
          region: "us",
          status: "ok-structured",
          items: [
            { name: "ChatGPT Plus", price: "$19.99", productId: "6448311597", billingPeriod: "P1M" },
            { name: "ChatGPT Plus", price: "$200.00", productId: "6745416289", billingPeriod: "P1Y" },
          ],
        },
        {
          region: "ph",
          status: "ok-structured",
          items: [
            { name: "ChatGPT Plus", price: "₱999.00", productId: "6448311597", billingPeriod: "P1M" },
            { name: "ChatGPT Plus", price: "₱9,990.00", productId: "6745416289", billingPeriod: "P1Y" },
          ],
        },
      ],
    },
  };
  const values = new Map([["private:compare:v7:6448311069", JSON.stringify({
    storedAt: generatedAt,
    source: "live",
    data: buildPrivateComparison(structuredComparison, {
      curatedPlans: planDefinitions["6448311069"],
      exchangeRates,
      regions,
    }),
  })]]);
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "v1", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: () => undefined,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.apiVersion, 1);
  assert.deepEqual(payload.data.plans.map((plan) => [plan.label, plan.period]), [
    ["ChatGPT Plus", "月付"],
    ["ChatGPT Plus", "年付"],
  ]);
});

test("private compare stops serving an existing degraded curated cache", async () => {
  const secret = "degraded-cache-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "6448311069" });
  const pathname = "/api/apps/private/v1/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const generatedAt = new Date().toISOString();
  const degradedComparison = {
    generatedAt,
    app: {
      id: "6448311069",
      matchedName: "ChatGPT",
      regions: [{
        region: "us",
        status: "ok-textPairs",
        identityStatus: "catalog-iap-view-missing",
        items: [
          { name: "ChatGPT Plus", price: "$19.99" },
          { name: "ChatGPT Plus", price: "$200.00" },
        ],
      }],
    },
  };
  const values = new Map([
    ["private:compare:v7:6448311069", JSON.stringify({
      storedAt: generatedAt,
      source: "live",
      data: buildPrivateComparison(degradedComparison, {
        curatedPlans: planDefinitions["6448311069"],
        exchangeRates,
        regions,
      }),
    })],
    ["private:lock:v1:6448311069", "already-refreshing"],
  ]);
  let backgroundStarted = false;
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "v1", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: () => { backgroundStarted = true; },
  });
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.status, "pending");
  assert.equal(payload.retryAfter, 30);
  assert.equal(backgroundStarted, true);
});

test("private compare returns a cached web-IAP limitation instead of restarting forever", async () => {
  const secret = "negative-cache-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "932747118" });
  const pathname = "/api/apps/private/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const values = new Map([["private:compare:v7:932747118", JSON.stringify({
    storedAt: new Date().toISOString(),
    error: "web-iap-not-public",
  })]]);
  let backgroundStarted = false;
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: () => { backgroundStarted = true; },
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "web-iap-not-public");
  assert.equal(backgroundStarted, false);
});

test("private v1 compare returns a terminal transient error instead of endless pending", async () => {
  const secret = "failed-cache-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "123456789" });
  const pathname = "/api/apps/private/v1/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const values = new Map([["private:compare:v7:123456789", JSON.stringify({
    storedAt: new Date().toISOString(),
    error: "refresh-failed",
  })]]);
  let backgroundStarted = false;
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "v1", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: () => { backgroundStarted = true; },
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error, "refresh-failed");
  assert.equal(payload.apiVersion, 1);
  assert.equal(backgroundStarted, false);
});

test("private compare serves stale cache when refresh startup fails", async () => {
  const secret = "stale-cache-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ target: "999999999" });
  const pathname = "/api/apps/private/compare";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\nPOST\n${pathname}\n${body}`)
    .digest("hex");
  const staleGeneratedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const values = new Map([
    ["private:compare:v7:999999999", JSON.stringify({
      storedAt: staleGeneratedAt,
      data: {
        generatedAt: staleGeneratedAt,
        app: { id: "999999999", name: "Cached App" },
        plans: [],
      },
    })],
  ]);
  let observedLockTtl = null;
  const background = [];
  const response = await onRequestPost({
    request: new Request(`https://price.example${pathname}`, {
      method: "POST",
      body,
      headers: {
        "x-price-timestamp": timestamp,
        "x-price-signature": signature,
      },
    }),
    params: { path: ["private", "compare"] },
    env: {
      PRICE_COMPARE_API_SECRET: secret,
      PRICE_COMPARE_KV: {
        get: async (key) => values.get(key) ?? null,
        put: async (key, value, options) => {
          if (key === "private:lock:v1:999999999") {
            observedLockTtl = options?.expirationTtl ?? null;
            if (observedLockTtl < 60) throw new Error("invalid expiration_ttl");
            throw new Error("stop refresh after validating lock ttl");
          }
          values.set(key, value);
        },
        delete: async (key) => values.delete(key),
      },
    },
    waitUntil: (promise) => background.push(promise),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "ready");
  assert.equal(payload.cache, "stale");
  assert.equal(payload.data.app.id, "999999999");
  await Promise.all(background);
  assert.ok(observedLockTtl >= 60);
});
