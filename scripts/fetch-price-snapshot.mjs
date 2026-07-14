import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const START_MARKER = '<script type="application/json" id="serialized-server-data">';
const END_MARKER = "</script>";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const configPath = resolve(option("--config", "data/catalog-config.json"));
const outputPath = resolve(option("--output", ".tmp/price-snapshot.json"));
const concurrency = Number(option("--concurrency", "6"));
const config = JSON.parse(await readFile(configPath, "utf8"));

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function request(url, { timeoutMs = 15_000, retries = 2, acceptedStatuses = [] } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "accept-language": "en-US,en;q=0.9", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok || acceptedStatuses.includes(response.status)) return response;
      const error = new Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await delay(500 * 2 ** attempt + Math.floor(Math.random() * 250));
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
  };
}

async function inspectRegion(appId, region) {
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

if (!Array.isArray(config.apps) || !Array.isArray(config.regions) || !config.apps.length || !config.regions.length) {
  throw new Error("Catalog configuration must contain non-empty apps and regions arrays");
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
  throw new Error("Concurrency must be an integer between 1 and 20");
}

console.log(`Resolving ${config.apps.length} fixed App IDs...`);
const apps = await mapLimit(config.apps, Math.min(concurrency, 4), fetchMetadata);
const regionTasks = apps.flatMap((app) => config.regions.map((region) => ({ appId: app.id, region })));
console.log(`Fetching ${regionTasks.length} App Store region pages with concurrency ${concurrency}...`);
const regionResults = await mapLimit(regionTasks, concurrency, ({ appId, region }) => inspectRegion(appId, region));

const regionsByApp = new Map(apps.map((app) => [app.id, []]));
for (let index = 0; index < regionTasks.length; index += 1) {
  regionsByApp.get(regionTasks[index].appId).push(regionResults[index]);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: "Apple public App Store product pages",
  regions: config.regions,
  apps: apps.map((app) => ({ ...app, regions: regionsByApp.get(app.id) })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Saved price snapshot to ${outputPath}`);
