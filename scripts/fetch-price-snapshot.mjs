import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractAppleMusicPlans, getAppleMusicPageUrl } from "./apple-music-prices.mjs";
import { extractAppleServicePlans, getAppleServicePageUrl } from "./apple-service-prices.mjs";

const START_MARKER = '<script type="application/json" id="serialized-server-data">';
const END_MARKER = "</script>";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const configPath = resolve(option("--config", "data/catalog-config.json"));
const regionsPath = resolve(option("--regions", "data/regions.json"));
const outputPath = resolve(option("--output", ".tmp/price-snapshot.json"));
const reuseOption = option("--reuse");
const reusePath = reuseOption ? resolve(reuseOption) : null;
const concurrency = Number(option("--concurrency", "6"));
const appStoreIntervalMs = Number(option("--app-store-interval", "300"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const regionData = JSON.parse(await readFile(regionsPath, "utf8"));
const regionCodes = regionData.regions?.map((region) => region.code) ?? [];
const reuseSnapshot = reusePath ? JSON.parse(await readFile(reusePath, "utf8")) : null;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const nextRequestAt = new Map();

async function throttle(url) {
  const host = new URL(url).host;
  const interval = host === "apps.apple.com" ? appStoreIntervalMs : host === "itunes.apple.com" ? 120 : 0;
  if (!interval) return;
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt.get(host) ?? 0);
  nextRequestAt.set(host, scheduledAt + interval);
  if (scheduledAt > now) await delay(scheduledAt - now);
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function request(url, { timeoutMs = 15_000, retries = 4, acceptedStatuses = [] } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await throttle(url);
      const response = await fetch(url, {
        headers: { "accept-language": "en-US,en;q=0.9", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok || acceptedStatuses.includes(response.status)) return response;
      const error = new Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
      if (attempt < retries) {
        const retryAfter = retryAfterMilliseconds(response);
        await delay(Math.max(retryAfter, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500));
        continue;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await delay(750 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
  throw lastError;
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function normalizeItems(items) {
  const seen = new Set();
  return items
    .map((item) => ({ name: String(item.name ?? "").trim(), price: String(item.price ?? "").trim() }))
    .filter((item) => item.name && item.price)
    .filter((item) => {
      const key = `${item.name}\u0000${item.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractIap(html) {
  const start = html.indexOf(START_MARKER);
  if (start === -1) return { status: "marker-missing", items: [] };
  const contentStart = start + START_MARKER.length;
  const end = html.indexOf(END_MARKER, contentStart);
  if (end === -1) return { status: "marker-unclosed", items: [] };

  const root = JSON.parse(html.slice(contentStart, end));
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    const isIapSection = value.title === "In-App Purchases";
    if (isIapSection && value.items?.[0]?.textPairs) {
      return {
        status: "ok-textPairs",
        items: normalizeItems(value.items[0].textPairs.map((pair) => ({ name: pair[0], price: pair[1] }))),
      };
    }
    if (isIapSection && Array.isArray(value.items_V3)) {
      return {
        status: "ok-itemsV3",
        items: normalizeItems(
          value.items_V3
            .filter((item) => item?.$kind === "textPair")
            .map((item) => ({ name: item.leadingText, price: item.trailingText })),
        ),
      };
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return { status: "iap-section-missing", items: [] };
}

async function fetchMetadata(entry) {
  if (entry.metadata) {
    return {
      query: entry.query,
      id: entry.id,
      ...entry.metadata,
      priceSource: entry.priceSource,
      service: entry.service,
    };
  }
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", entry.id);
  url.searchParams.set("country", "us");
  url.searchParams.set("entity", "software");
  const payload = await (await request(url)).json();
  const result = payload.results?.find((item) => String(item.trackId) === entry.id);
  if (!result) throw new Error(`App ID ${entry.id} lookup failed`);
  return {
    query: entry.query,
    id: entry.id,
    matchedName: result.trackName,
    developer: result.sellerName,
    icon: result.artworkUrl512 || result.artworkUrl100,
    category: result.primaryGenreName,
    storeUrl: result.trackViewUrl,
    priceSource: entry.priceSource ?? "app-store",
  };
}

const pageRequests = new Map();

function cachedPage(url) {
  if (!pageRequests.has(url)) pageRequests.set(url, request(url, { acceptedStatuses: [404] }));
  return pageRequests.get(url);
}

function redirectedAwayFromPricePage(response, requestedUrl) {
  const requestedPath = new URL(requestedUrl).pathname.replace(/\/+$/u, "") || "/";
  const responsePath = new URL(response.url).pathname.replace(/\/+$/u, "") || "/";
  return requestedPath !== responsePath;
}

function isAppleRedirectShell(html) {
  return /<title[^>]*>\s*Apple\s*-\s*Redirect\s*<\/title>/iu.test(html)
    || /['"]s-channel['"]\s*:\s*['"]redirects['"]/iu.test(html);
}

async function inspectAppStoreRegion(appId, region) {
  const url = `https://apps.apple.com/${region}/app/id${appId}?l=en`;
  try {
    const response = await request(url, { acceptedStatuses: [404] });
    if (response.status === 404) return { region, status: "error:HTTP 404", itemCount: 0, items: [] };
    const extracted = extractIap(await response.text());
    return { region, ...extracted, itemCount: extracted.items.length };
  } catch (error) {
    return { region, status: `error:${error.message}`, itemCount: 0, items: [] };
  }
}

async function inspectAppleMusicRegion(region) {
  const url = getAppleMusicPageUrl(region);
  try {
    const response = await request(url, { acceptedStatuses: [404] });
    if (response.status === 404 || redirectedAwayFromPricePage(response, url)) {
      return { region, status: "official-price-page-missing", itemCount: 0, items: [] };
    }
    const html = await response.text();
    if (isAppleRedirectShell(html)) return { region, status: "official-price-page-missing", itemCount: 0, items: [] };
    const items = extractAppleMusicPlans(html, region);
    const status = items.length >= 2 ? "ok-apple-music-page" : "error:apple-music-plans-missing";
    return { region, status, itemCount: items.length, items };
  } catch (error) {
    return { region, status: `error:${error.message}`, itemCount: 0, items: [] };
  }
}

async function inspectAppleServiceRegion(app, region) {
  const url = getAppleServicePageUrl(region, app.service);
  try {
    const response = await cachedPage(url);
    if (response.status === 404 || redirectedAwayFromPricePage(response, url)) {
      return { region, status: "official-price-page-missing", itemCount: 0, items: [] };
    }
    const html = await response.clone().text();
    if (isAppleRedirectShell(html)) return { region, status: "official-price-page-missing", itemCount: 0, items: [] };
    const items = extractAppleServicePlans(html, region, app.service);
    const expectedMinimum = app.service === "icloud-plus"
      ? 5
      : app.service === "apple-one" || app.service === "apple-fitness-plus"
        ? 2
        : 1;
    const status = items.length >= expectedMinimum ? `ok-${app.service}-page` : `error:${app.service}-plans-missing`;
    return { region, status, itemCount: items.length, items };
  } catch (error) {
    return { region, status: `error:${error.message}`, itemCount: 0, items: [] };
  }
}

async function inspectRegion(app, region) {
  if (app.priceSource === "apple-music") return inspectAppleMusicRegion(region);
  if (app.priceSource === "apple-service") return inspectAppleServiceRegion(app, region);
  return inspectAppStoreRegion(app.id, region);
}

function reusableRegion(appId, regionCode) {
  const region = reuseSnapshot?.apps
    ?.find((app) => app.id === appId)
    ?.regions?.find((candidate) => candidate.region === regionCode);
  if (!region) return null;
  const safeEmpty = ["iap-section-missing", "official-price-page-missing", "error:HTTP 404"].includes(region.status);
  const safePopulated = region.status?.startsWith("ok-") && region.itemCount > 0;
  return safeEmpty || safePopulated ? region : null;
}

if (!Array.isArray(config.apps) || !config.apps.length || !regionCodes.length) {
  throw new Error("Catalog and region configuration must contain non-empty arrays");
}
if (new Set(regionCodes).size !== regionCodes.length) throw new Error("Region codes must be unique");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
  throw new Error("Concurrency must be an integer between 1 and 20");
}
if (!Number.isFinite(appStoreIntervalMs) || appStoreIntervalMs < 0 || appStoreIntervalMs > 10_000) {
  throw new Error("App Store interval must be between 0 and 10000 milliseconds");
}

console.log(`Resolving ${config.apps.length} fixed catalog entries...`);
const apps = await mapLimit(config.apps, Math.min(concurrency, 4), fetchMetadata);
const regionTasks = apps.flatMap((app) => regionCodes.map((region) => ({ app, region })));
const reusableCount = regionTasks.filter(({ app, region }) => reusableRegion(app.id, region)).length;
console.log(`Fetching ${regionTasks.length - reusableCount} Apple public price pages with concurrency ${concurrency}${reusableCount ? `; reusing ${reusableCount} verified rows` : ""}...`);
const regionResults = await mapLimit(regionTasks, concurrency, ({ app, region }) => reusableRegion(app.id, region) ?? inspectRegion(app, region));

const regionsByApp = new Map(apps.map((app) => [app.id, []]));
for (let index = 0; index < regionTasks.length; index += 1) {
  regionsByApp.get(regionTasks[index].app.id).push(regionResults[index]);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: "Apple public App Store product and service pricing pages",
  regions: regionCodes,
  apps: apps.map((app) => ({ ...app, regions: regionsByApp.get(app.id) })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Saved price snapshot to ${outputPath}`);
