import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import exchangeRateSnapshot from "../data/exchange-rates.json" with { type: "json" };
import planDefinitions from "../data/plan-definitions.json" with { type: "json" };
import regionSnapshot from "../data/regions.json" with { type: "json" };
import validationSnapshot from "../data/validation-snapshot.json" with { type: "json" };
import { buildPrivateComparison } from "../functions/lib/private-comparison.js";
import {
  classifyPrivateRefreshError,
  onRequestPost,
  privateSearch,
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

test("private comparison anchors duplicate plans to US occurrences", () => {
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
            { name: "Example Plus", price: "₱400.00" },
            { name: "Example Plus", price: "₱4,000.00" },
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
  assert.equal(payload.plans[0].prices[0].code, "ph");
  assert.equal(payload.plans[1].prices.find((price) => price.code === "us").price, "$100.00");
  assert.equal(payload.primaryPlanCount, 2);
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

test("private name search trusts Apple's first US result and skips candidate selection", async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
  };
  const payload = await privateSearch("Sky Guide", storage, async (input) => {
    const url = new URL(input);
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
  assert.ok(values.has("private:search:v2:skyguide"));
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

test("private health endpoint requires signing and configured storage", async () => {
  const secret = "health-secret";
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
        delete: async () => undefined,
      },
    },
    waitUntil: () => undefined,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
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

test("private compare serves a signed curated snapshot without starting a crawl", async () => {
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
  values.set("private:compare:v1:6448311069", JSON.stringify({
    storedAt: generatedAt,
    data: buildPrivateComparison({ generatedAt, app }, {
      curatedPlans: planDefinitions[app.id] ?? [],
      exchangeRates: exchangeRateSnapshot,
      regions: regionSnapshot.regions,
    }),
  }));
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
    waitUntil: () => undefined,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, "ready");
  assert.equal(payload.data.app.id, "6448311069");
  assert.ok(payload.data.plans.some((plan) => plan.label === "ChatGPT Plus"));
  assert.equal(payload.data.regionCount, 20);
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
    ["private:compare:v1:999999999", JSON.stringify({
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
