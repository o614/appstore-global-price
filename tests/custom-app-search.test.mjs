import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractAppleCatalog } from "../app/lib/apple-catalog.mjs";
import {
  REGIONS,
  compareAppleApp,
  extractAppSearchPage,
  extractAppStorePage,
  inspectRegion,
  onRequest,
  parseAppId,
  searchAppleApps,
} from "../functions/api/apps/[[path]].js";

const appId = "123456789";

function response(body, { status = 200, url = "https://example.test/" } = {}) {
  const base = new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  return {
    ok: base.ok,
    status: base.status,
    url,
    headers: base.headers,
    body: base.body,
  };
}

function appPageHtml(name = "Example App") {
  const payload = [{
    data: [{
      data: {
        title: name,
        developerAction: { title: "Example Developer" },
        lockup: {
          icon: { template: "https://example.test/icon/{w}x{h}.{f}" },
        },
        shelves: [{
          title: "In-App Purchases",
          items: [{
            textPairs: [
              ["Monthly", "$9.99"],
              ["Yearly", "$99.99"],
            ],
          }],
        }],
      },
    }],
  }];
  return `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(payload)}</script></html>`;
}

function catalogPayload(region = "us") {
  const prices = {
    us: ["$7.99", "$69.99"],
    ph: ["₱399.00", "₱3,490.00"],
  };
  const [monthlyPrice, annualPrice] = prices[region] ?? ["$8.99", "$79.99"];
  const item = (id, price, offerName, period) => ({
    id,
    type: "in-apps",
    attributes: {
      name: "Example Plus",
      offerName,
      isSubscription: true,
      subscriptionFamilyId: "family-1",
      offers: [{ type: "buy", priceFormatted: price, recurringSubscriptionPeriod: period }],
    },
  });
  return {
    data: [{
      id: appId,
      type: "apps",
      attributes: {
        name: "Example App",
        artistName: "Example Developer",
        url: `https://apps.apple.com/${region}/app/id${appId}`,
      },
      views: {
        "top-in-app-purchasables": {
          data: [
            item("1363566605", monthlyPrice, "com.example.monthly", "P1M"),
            item("1382870714", annualPrice, "com.example.annual", "P1Y"),
          ],
        },
      },
    }],
  };
}

test("custom search remains locked to the configured 18 regions", async () => {
  const regionFile = JSON.parse(await readFile(new URL("../data/regions.json", import.meta.url), "utf8"));
  assert.equal(REGIONS.length, 18);
  assert.deepEqual(
    REGIONS.map((region) => region.code),
    regionFile.regions.map((region) => region.code),
  );
});

test("App ID parser accepts IDs and App Store URLs only", () => {
  assert.equal(parseAppId(appId), appId);
  assert.equal(parseAppId(`https://apps.apple.com/us/app/example/id${appId}?l=en`), appId);
  assert.equal(parseAppId("example app"), null);
  assert.equal(parseAppId("123"), null);
});

test("App Store page parser extracts metadata and public purchases", () => {
  const extracted = extractAppStorePage(appPageHtml());
  assert.equal(extracted.status, "ok-textPairs");
  assert.equal(extracted.metadata.matchedName, "Example App");
  assert.deepEqual(extracted.items, [
    { name: "Monthly", price: "$9.99" },
    { name: "Yearly", price: "$99.99" },
  ]);
});

test("Apple catalog parser preserves official product identity and billing period", () => {
  const extracted = extractAppleCatalog(catalogPayload("us"), appId);
  assert.equal(extracted.status, "ok-structured");
  assert.equal(extracted.metadata.matchedName, "Example App");
  assert.deepEqual(extracted.items[0], {
    name: "Example Plus",
    price: "$7.99",
    productId: "1363566605",
    offerName: "com.example.monthly",
    billingPeriod: "P1M",
    subscriptionFamilyId: "family-1",
    isSubscription: true,
  });
});

test("US comparison stops on a definite missing public IAP section before catalog lookup", async () => {
  const requestedUrls = [];
  const payload = [{
    data: [{
      data: {
        title: "Example App",
        developerAction: { title: "Example Developer" },
        lockup: { icon: { template: "https://example.test/icon/{w}x{h}.{f}" } },
        shelves: [],
      },
    }],
  }];
  const html = `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(payload)}</script></html>`;
  const inspected = await inspectRegion(appId, { code: "us", name: "美国" }, async (input) => {
    const url = new URL(input);
    requestedUrls.push(String(url));
    assert.doesNotMatch(url.pathname, /\/api\/apps\/v1\/catalog\//u);
    return response(html, { url: String(url) });
  }, AbortSignal.timeout(1_000));

  assert.equal(inspected.row.status, "iap-section-missing");
  assert.equal(inspected.row.itemCount, 0);
  assert.equal(inspected.metadata.matchedName, "Example App");
  assert.equal(requestedUrls.length, 1);
});

test("custom comparison uses Apple catalog identities in every region", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes("/api/apps/v1/catalog/")) {
      const region = url.pathname.split("/")[5];
      return response(JSON.stringify(catalogPayload(region)), { url: String(url) });
    }
    return response(JSON.stringify({ resultCount: 0, results: [] }), { url: String(url) });
  };

  const comparison = await compareAppleApp(appId, fetchImpl);
  assert.equal(comparison.app.regions.length, REGIONS.length);
  assert.ok(comparison.app.regions.every((region) => region.status === "ok-structured"));
  assert.ok(comparison.app.regions.every((region) => region.items[0].productId === "1363566605"));
  assert.ok(comparison.app.regions.every((region) => region.items[0].billingPeriod === "P1M"));
});

test("App Store search page parser extracts apps and skips bundles", () => {
  const payload = {
    data: [{
      data: {
        shelves: [{
          items: [
            {
              resultType: "app",
              lockup: {
                adamId: appId,
                title: "Example App",
                subtitle: "Example Developer",
                icon: { template: "https://example.test/icon/{w}x{h}.{f}" },
              },
            },
            {
              resultType: "bundle",
              lockup: {
                adamId: "987654321",
                title: "Example Bundle",
              },
            },
          ],
        }],
      },
    }],
  };
  const html = `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(payload)}</script></html>`;
  assert.deepEqual(extractAppSearchPage(html, "us"), [{
    appId,
    appName: "Example App",
    developer: "Example Developer",
    icon: "https://example.test/icon/512x512.jpg",
    storeUrl: `https://apps.apple.com/us/app/id${appId}`,
    sourceRegion: "us",
  }]);
});

test("search de-duplicates regional Apple results", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "apps.apple.com" && url.pathname.endsWith("/search")) {
      const country = url.pathname.split("/")[1];
      const payload = {
        data: [{
          data: {
            shelves: [{
              items: country === "us" || country === "ca"
                ? [{
                    resultType: "app",
                    lockup: {
                      adamId: appId,
                      title: "Example App",
                      subtitle: "Example Developer",
                      icon: { template: "https://example.test/icon/{w}x{h}.{f}" },
                    },
                  }]
                : [],
            }],
          },
        }],
      };
      return response(
        `<html><script type="application/json" id="serialized-server-data">${JSON.stringify(payload)}</script></html>`,
        { url: String(url) },
      );
    }
    const country = url.searchParams.get("country");
    const results = country === "us" || country === "ca"
      ? [{
          trackId: Number(appId),
          trackName: "Example App",
          sellerName: "Example Developer",
          artworkUrl512: "https://example.test/icon.png",
          trackViewUrl: `https://apps.apple.com/${country}/app/id${appId}`,
        }]
      : [];
    return response(JSON.stringify({ resultCount: results.length, results }), { url: String(url) });
  };

  const results = await searchAppleApps("Example App", fetchImpl);
  assert.equal(results.length, 1);
  assert.equal(results[0].appId, appId);
  assert.equal(results[0].appName, "Example App");
});

test("search removes unrelated Apple suggestions when a text match exists", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "apps.apple.com") {
      return response("not found", { status: 404, url: String(url) });
    }
    const country = url.searchParams.get("country");
    const results = country === "us"
      ? [
          {
            trackId: 363590051,
            trackName: "Netflix",
            sellerName: "Netflix, Inc.",
            artworkUrl512: "https://example.test/netflix.png",
            trackViewUrl: "https://apps.apple.com/us/app/id363590051",
          },
          {
            trackId: 6448311069,
            trackName: "ChatGPT",
            sellerName: "OpenAI",
            artworkUrl512: "https://example.test/chatgpt.png",
            trackViewUrl: "https://apps.apple.com/us/app/id6448311069",
          },
          {
            trackId: 284882215,
            trackName: "Facebook",
            sellerName: "Meta Platforms, Inc.",
            artworkUrl512: "https://example.test/facebook.png",
            trackViewUrl: "https://apps.apple.com/us/app/id284882215",
          },
        ]
      : [];
    return response(JSON.stringify({ resultCount: results.length, results }), { url: String(url) });
  };

  const results = await searchAppleApps("Netflix", fetchImpl);
  assert.deepEqual(results.map((result) => result.appName), ["Netflix"]);
});

test("search keeps Apple's suggestions when no result text matches the query", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "apps.apple.com") {
      return response("not found", { status: 404, url: String(url) });
    }
    const country = url.searchParams.get("country");
    const results = country === "us"
      ? [{
          trackId: Number(appId),
          trackName: "Example App",
          sellerName: "Example Developer",
          artworkUrl512: "https://example.test/icon.png",
          trackViewUrl: `https://apps.apple.com/${country}/app/id${appId}`,
        }]
      : [];
    return response(JSON.stringify({ resultCount: results.length, results }), { url: String(url) });
  };

  const results = await searchAppleApps("untranslated query", fetchImpl);
  assert.equal(results.length, 1);
  assert.equal(results[0].appName, "Example App");
});

test("direct App ID search falls back to the official App Store page", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "apps.apple.com" && url.pathname === `/us/app/id${appId}`) {
      return response(appPageHtml(), { url: String(url) });
    }
    if (url.hostname === "apps.apple.com") {
      return response("not found", { status: 404, url: String(url) });
    }
    return response(JSON.stringify({ resultCount: 0, results: [] }), { url: String(url) });
  };

  const results = await searchAppleApps(appId, fetchImpl);
  assert.equal(results.length, 1);
  assert.equal(results[0].appId, appId);
  assert.equal(results[0].appName, "Example App");
  assert.equal(results[0].sourceRegion, "us");
});

test("one regional failure does not stop the remaining comparison", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "apps.apple.com") {
      const region = url.pathname.split("/")[1];
      if (region === "tr") {
        return response("temporary failure", { status: 503, url: String(url) });
      }
      return response(appPageHtml(), { url: String(url) });
    }
    return response(JSON.stringify({ resultCount: 0, results: [] }), { url: String(url) });
  };

  const comparison = await compareAppleApp(appId, fetchImpl);
  assert.equal(comparison.regionCount, REGIONS.length);
  assert.equal(comparison.app.regions.length, REGIONS.length);
  assert.equal(comparison.app.regions.filter((region) => region.status === "ok-textPairs").length, REGIONS.length - 1);
  assert.match(
    comparison.app.regions.find((region) => region.region === "tr").status,
    /^error:/u,
  );
});

test("an exhausted total request budget returns a complete degraded region list", async () => {
  const comparison = await compareAppleApp(appId, fetch, AbortSignal.abort());
  assert.equal(comparison.app.regions.length, REGIONS.length);
  assert.equal(
    comparison.app.regions.filter((region) => region.status === "error:request-budget-exhausted").length,
    REGIONS.length,
  );
});

test("unsupported API methods are rejected with an explicit Allow header", async () => {
  const response = await onRequest({
    request: new Request("https://price.example/api/apps/search", { method: "POST" }),
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});
