import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractAppleMusicPlans, getAppleMusicPageUrl } from "./apple-music-prices.mjs";
import { extractAppleServicePlans, getAppleServicePageUrl } from "./apple-service-prices.mjs";
import { inferCatalogGroup, normalizeCatalogEntries } from "./catalog-config.mjs";

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
const appBatchSize = Number(option("--app-batch-size", "4"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const catalogEntries = normalizeCatalogEntries(config.apps);
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
      query: entry.query ?? entry.metadata.matchedName ?? entry.id,
      id: entry.id,
      ...entry.metadata,
      group: entry.group ?? entry.metadata.group ?? inferCatalogGroup(entry.metadata.category),
      priceSource: entry.priceSource,
      service: entry.service,
      regionalAppIds: entry.regionalAppIds,
      excludeItemNames: entry.excludeItemNames,
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
    query: entry.query ?? result.trackName,
    id: entry.id,
    matchedName: result.trackName,
    developer: result.sellerName,
    icon: result.artworkUrl512 || result.artworkUrl100,
    category: result.primaryGenreName,
    group: entry.group ?? inferCatalogGroup(result.primaryGenreName),
    storeUrl: result.trackViewUrl,
    priceSource: entry.priceSource ?? "app-store",
    regionalAppIds: entry.regionalAppIds,
    excludeItemNames: entry.excludeItemNames,
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

async function inspectAppStoreRegion(app, region) {
  const regionalAppId = app.regionalAppIds?.[region] ?? app.id;
  const url = `https://apps.apple.com/${region}/app/id${regionalAppId}?l=en`;
  try {
    const response = await request(url, { acceptedStatuses: [404] });
    if (response.status === 404) return { region, status: "error:HTTP 404", itemCount: 0, items: [] };
    const extracted = extractIap(await response.text());
    const excludedNames = new Set((app.excludeItemNames ?? []).map((name) => name.toLocaleLowerCase("en-US")));
    const items = extracted.items.filter((item) => !excludedNames.has(item.name.toLocaleLowerCase("en-US")));
    return { region, status: extracted.status, itemCount: items.length, items };
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
  return inspectAppStoreRegion(app, region);
}

function reusableRegion(app, regionCode) {
  if (app.excludeItemNames?.length || app.regionalAppIds?.[regionCode]) return null;
  const region = reuseSnapshot?.apps
    ?.find((candidate) => candidate.id === app.id)
    ?.regions?.find((candidate) => candidate.region === regionCode);
  if (!region) return null;
  const safeEmpty = ["iap-section-missing", "official-price-page-missing", "error:HTTP 404"].includes(region.status);
  const safePopulated = region.status?.startsWith("ok-") && region.itemCount > 0;
  return safeEmpty || safePopulated ? region : null;
}

if (!regionCodes.length) {
  throw new Error("Catalog and region configuration must contain non-empty arrays");
}
if (new Set(regionCodes).size !== regionCodes.length) throw new Error("Region codes must be unique");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
  throw new Error("Concurrency must be an integer between 1 and 20");
}
if (!Number.isFinite(appStoreIntervalMs) || appStoreIntervalMs < 0 || appStoreIntervalMs > 10_000) {
  throw new Error("App Store interval must be between 0 and 10000 milliseconds");
}
if (!Number.isInteger(appBatchSize) || appBatchSize < 1 || appBatchSize > 20) {
  throw new Error("App batch size must be an integer between 1 and 20");
}

await mkdir(dirname(outputPath), { recursive: true });
console.log(`Resolving ${catalogEntries.length} fixed catalog entries...`);
const apps = await mapLimit(catalogEntries, Math.min(concurrency, 4), fetchMetadata);
const regionsByApp = new Map();
const completedAppIds = new Set();
const batches = Array.from(
  { length: Math.ceil(apps.length / appBatchSize) },
  (_, index) => apps.slice(index * appBatchSize, (index + 1) * appBatchSize),
);

for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
  const batch = batches[batchIndex];
  const regionTasks = batch.flatMap((app) => regionCodes.map((region) => ({ app, region })));
  const reusableCount = regionTasks.filter(({ app, region }) => reusableRegion(app, region)).length;
  console.log(
    `Batch ${batchIndex + 1}/${batches.length}: fetching ${regionTasks.length - reusableCount} Apple public price pages`
      + `${reusableCount ? `; reusing ${reusableCount} verified rows` : ""}...`,
  );
  const regionResults = await mapLimit(
    regionTasks,
    concurrency,
    ({ app, region }) => reusableRegion(app, region) ?? inspectRegion(app, region),
  );
  for (const app of batch) regionsByApp.set(app.id, []);
  for (let index = 0; index < regionTasks.length; index += 1) {
    regionsByApp.get(regionTasks[index].app.id).push(regionResults[index]);
  }
  for (const app of batch) completedAppIds.add(app.id);

  const checkpoint = {
    generatedAt: new Date().toISOString(),
    source: "Apple public App Store product and service pricing pages",
    regions: regionCodes,
    apps: apps
      .filter((app) => completedAppIds.has(app.id))
      .map((app) => {
        const publishedApp = Object.fromEntries(
          Object.entries(app).filter(([key]) => key !== "excludeItemNames"),
        );
        return { ...publishedApp, regions: regionsByApp.get(app.id) };
      }),
  };
  await writeFile(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  console.log(`Saved checkpoint with ${checkpoint.apps.length}/${apps.length} catalog entries.`);
}

console.log(`Saved price snapshot to ${outputPath}`);
