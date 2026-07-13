import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const APPS = [
  "ChatGPT",
  "Claude by Anthropic",
  "Google Gemini",
  "Grok AI",
  "Telegram Messenger",
  "YouTube",
  "X",
  "Google One",
  "百度网盘",
  "Spotify",
];

const REGIONS = ["cn", "us", "jp", "hk", "tw", "tr", "ph", "pk", "ca", "sg"];
const START_MARKER = '<script type="application/json" id="serialized-server-data">';
const END_MARKER = "</script>";

async function request(url, timeoutMs = 10_000) {
  const response = await fetch(url, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function findApp(query) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "software");
  url.searchParams.set("country", "us");
  url.searchParams.set("limit", "3");
  const data = await (await request(url)).json();
  const result = data.results?.[0];
  if (!result) throw new Error("not found");
  return {
    id: String(result.trackId),
    name: result.trackName,
    developer: result.sellerName,
    icon: result.artworkUrl512 || result.artworkUrl100,
    category: result.primaryGenreName,
    storeUrl: result.trackViewUrl,
  };
}

function normalizeItems(items) {
  const seen = new Set();
  return items
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      price: String(item.price ?? "").trim(),
    }))
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
        items: normalizeItems(
          value.items[0].textPairs.map((pair) => ({ name: pair[0], price: pair[1] })),
        ),
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

async function inspectRegion(appId, region) {
  const url = `https://apps.apple.com/${region}/app/id${appId}?l=en`;
  try {
    const html = await (await request(url)).text();
    return { region, ...extractIap(html) };
  } catch (error) {
    return { region, status: `error:${error.message}`, items: [] };
  }
}

const resolvedApps = [];
for (const query of APPS) {
  try {
    resolvedApps.push({ query, ...(await findApp(query)) });
  } catch (error) {
    resolvedApps.push({ query, error: error.message });
  }
}

const results = [];
for (const app of resolvedApps) {
  if (!app.id) {
    results.push(app);
    continue;
  }

  const regions = await Promise.all(REGIONS.map((region) => inspectRegion(app.id, region)));
  results.push({ ...app, regions });
}

const summary = results.map((app) => ({
  query: app.query,
  id: app.id,
  matchedName: app.name,
  developer: app.developer,
  icon: app.icon,
  category: app.category,
  storeUrl: app.storeUrl,
  error: app.error,
  regions: app.regions?.map((region) => ({
    region: region.region,
    status: region.status,
    itemCount: region.items.length,
    sample: region.items.slice(0, 5),
  })),
}));

const serialized = JSON.stringify(summary, null, 2);
const outputFlagIndex = process.argv.indexOf("--output");
if (outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]) {
  const outputPath = resolve(process.argv[outputFlagIndex + 1]);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serialized}\n`, "utf8");
  console.log(`Saved validation snapshot to ${outputPath}`);
} else {
  console.log(serialized);
}
