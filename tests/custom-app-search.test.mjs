import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REGIONS,
  compareAppleApp,
  extractAppSearchPage,
  extractAppStorePage,
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

test("custom search remains locked to the configured 20 regions", async () => {
  const regionFile = JSON.parse(await readFile(new URL("../data/regions.json", import.meta.url), "utf8"));
  assert.equal(REGIONS.length, 20);
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
  assert.equal(comparison.regionCount, 20);
  assert.equal(comparison.app.regions.length, 20);
  assert.equal(comparison.app.regions.filter((region) => region.status === "ok-textPairs").length, 19);
  assert.match(
    comparison.app.regions.find((region) => region.region === "tr").status,
    /^error:/u,
  );
});
