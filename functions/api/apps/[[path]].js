import exchangeRates from "../../generated/exchange-rates.mjs";
import planDefinitions from "../../generated/plan-definitions.mjs";
import regionData from "../../generated/regions.mjs";
import validationSnapshot from "../../generated/validation-snapshot.mjs";
import { buildPrivateComparison } from "../../lib/private-comparison.js";

export const REGIONS = [
  { code: "cn", name: "中国" },
  { code: "us", name: "美国" },
  { code: "hk", name: "香港" },
  { code: "tw", name: "台湾" },
  { code: "vn", name: "越南" },
  { code: "sg", name: "新加坡" },
  { code: "jp", name: "日本" },
  { code: "kr", name: "韩国" },
  { code: "th", name: "泰国" },
  { code: "gb", name: "英国" },
  { code: "de", name: "德国" },
  { code: "fr", name: "法国" },
  { code: "ca", name: "加拿大" },
  { code: "tr", name: "土耳其" },
  { code: "au", name: "澳大利亚" },
  { code: "ph", name: "菲律宾" },
  { code: "ng", name: "尼日利亚" },
  { code: "in", name: "印度" },
  { code: "br", name: "巴西" },
  { code: "id", name: "印度尼西亚" },
];

const START_MARKER = '<script type="application/json" id="serialized-server-data">';
const END_MARKER = "</script>";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36";
const MAX_APP_PAGE_BYTES = 6_000_000;
const MAX_JSON_BYTES = 1_000_000;
const TOTAL_REQUEST_TIMEOUT_MS = 18_000;
const PRIVATE_BODY_BYTES = 4_096;
const PRIVATE_CLOCK_SKEW_SECONDS = 300;
const PRIVATE_FRESH_SECONDS = 12 * 60 * 60;
const PRIVATE_STALE_SECONDS = 7 * 24 * 60 * 60;
const PRIVATE_HOT_REFRESH_SECONDS = 3 * 60 * 60;
const PRIVATE_MANUAL_REFRESH_SECONDS = 30 * 60;
const PRIVATE_GLOBAL_REQUESTS_PER_MINUTE = 60;
const PRIVATE_INITIAL_WAIT_MS = 2_800;
const PRIVATE_REFRESH_LOCK_SECONDS = 30;

function jsonResponse(payload, status = 200, cacheControl = "no-store", extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "content-type": "application/json; charset=utf-8",
      "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function publicError(error) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "请求 Apple 超时";
    if (/^HTTP \d{3}$/u.test(error.message)) return error.message;
  }
  return "Apple 公开页面暂时无法读取";
}

async function readTextWithLimit(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("response-too-large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new Error("response-too-large");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function appleRequest(url, fetchImpl = fetch, acceptedStatuses = [], deadlineSignal) {
  const signal = deadlineSignal
    ? AbortSignal.any([deadlineSignal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal,
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function appleJson(url, fetchImpl = fetch, deadlineSignal) {
  const response = await appleRequest(url, fetchImpl, [], deadlineSignal);
  return JSON.parse(await readTextWithLimit(response, MAX_JSON_BYTES));
}

async function mapLimit(values, limit, task, deadlineSignal) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      if (deadlineSignal?.aborted) return;
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

function artworkFromTemplate(value) {
  if (typeof value !== "string") return null;
  return value
    .replaceAll("{w}", "512")
    .replaceAll("{h}", "512")
    .replaceAll("{f}", "jpg")
    .replaceAll("{c}", "bb")
    .replaceAll("{q}", "80");
}

export function extractAppStorePage(html) {
  const start = html.indexOf(START_MARKER);
  if (start === -1) return { status: "marker-missing", items: [], metadata: null };
  const contentStart = start + START_MARKER.length;
  const end = html.indexOf(END_MARKER, contentStart);
  if (end === -1) return { status: "marker-unclosed", items: [], metadata: null };

  const root = JSON.parse(html.slice(contentStart, end));
  let metadata = null;
  let iap = null;
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    if (
      !metadata
      && typeof value.title === "string"
      && value.lockup
      && typeof value.lockup === "object"
      && value.developerAction
      && typeof value.developerAction === "object"
    ) {
      metadata = {
        matchedName: value.title,
        developer: typeof value.developerAction.title === "string" ? value.developerAction.title : "",
        icon: artworkFromTemplate(value.lockup.icon?.template),
      };
    }

    if (value.title === "In-App Purchases" && value.items?.[0]?.textPairs) {
      iap = {
        status: "ok-textPairs",
        items: normalizeItems(value.items[0].textPairs.map((pair) => ({ name: pair[0], price: pair[1] }))),
      };
    } else if (value.title === "In-App Purchases" && Array.isArray(value.items_V3)) {
      iap = {
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

  return {
    status: iap?.status ?? "iap-section-missing",
    items: iap?.items ?? [],
    metadata,
  };
}

export function extractAppSearchPage(html, sourceRegion) {
  const start = html.indexOf(START_MARKER);
  if (start === -1) return [];
  const contentStart = start + START_MARKER.length;
  const end = html.indexOf(END_MARKER, contentStart);
  if (end === -1) return [];

  const root = JSON.parse(html.slice(contentStart, end));
  const queue = [root];
  const results = [];
  const seen = new Set();
  let cursor = 0;

  while (cursor < queue.length && cursor < 20_000) {
    const value = queue[cursor];
    cursor += 1;
    if (!value || typeof value !== "object") continue;

    const lockup = value.lockup;
    const appId = String(lockup?.adamId ?? "");
    if (
      value.resultType !== "bundle"
      && /^\d{6,12}$/u.test(appId)
      && typeof lockup?.title === "string"
      && !seen.has(appId)
    ) {
      seen.add(appId);
      results.push({
        appId,
        appName: lockup.title.trim(),
        developer: typeof lockup.subtitle === "string" ? lockup.subtitle.trim() : "",
        icon: artworkFromTemplate(lockup.icon?.template),
        storeUrl: `https://apps.apple.com/${sourceRegion}/app/id${appId}`,
        sourceRegion,
      });
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }

  return results;
}

export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function parseAppId(value) {
  const text = String(value ?? "").trim();
  if (/^\d{6,12}$/u.test(text)) return text;
  const match = text.match(/\/id(\d{6,12})(?:[/?#]|$)/u);
  return match?.[1] ?? null;
}

function appSearchResult(item, sourceRegion) {
  const appId = String(item.trackId ?? "");
  if (!/^\d{6,12}$/u.test(appId)) return null;
  return {
    appId,
    appName: String(item.trackName ?? "").trim(),
    developer: String(item.sellerName ?? item.artistName ?? "").trim(),
    icon: item.artworkUrl512 || item.artworkUrl100 || null,
    storeUrl: item.trackViewUrl || `https://apps.apple.com/${sourceRegion}/app/id${appId}`,
    sourceRegion,
  };
}

async function searchRegion(query, region, fetchImpl, deadlineSignal) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("country", region.code);
  url.searchParams.set("media", "software");
  url.searchParams.set("entity", "software");
  url.searchParams.set("limit", "8");
  try {
    const payload = await appleJson(url, fetchImpl, deadlineSignal);
    return (payload.results ?? [])
      .map((item) => appSearchResult(item, region.code))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function searchAppStorePage(query, regionCode, platform, fetchImpl, deadlineSignal) {
  const url = new URL(`https://apps.apple.com/${regionCode}/${platform}/search`);
  url.searchParams.set("term", query);
  try {
    const response = await appleRequest(url, fetchImpl, [], deadlineSignal);
    return extractAppSearchPage(
      await readTextWithLimit(response, MAX_APP_PAGE_BYTES),
      regionCode,
    );
  } catch {
    return [];
  }
}

async function lookupRegion(appId, region, fetchImpl, deadlineSignal) {
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", appId);
  url.searchParams.set("country", region.code);
  url.searchParams.set("entity", "software");
  try {
    const payload = await appleJson(url, fetchImpl, deadlineSignal);
    return (payload.results ?? [])
      .map((item) => appSearchResult(item, region.code))
      .find((item) => item?.appId === appId) ?? null;
  } catch {
    return null;
  }
}

async function lookupAppStorePage(appId, region, fetchImpl, deadlineSignal) {
  const requestedUrl = `https://apps.apple.com/${region.code}/app/id${appId}?l=en`;
  try {
    const response = await appleRequest(requestedUrl, fetchImpl, [404], deadlineSignal);
    const resolvedUrl = response.url || requestedUrl;
    if (response.status === 404 || !new URL(resolvedUrl).pathname.includes(`id${appId}`)) return null;
    const metadata = extractAppStorePage(
      await readTextWithLimit(response, MAX_APP_PAGE_BYTES),
    ).metadata;
    if (!metadata) return null;
    return {
      appId,
      appName: metadata.matchedName,
      developer: metadata.developer,
      icon: metadata.icon,
      storeUrl: resolvedUrl,
      sourceRegion: region.code,
    };
  } catch {
    return null;
  }
}

export async function searchAppleApps(query, fetchImpl = fetch, deadlineSignal) {
  const directId = parseAppId(query);
  let regionalResults;
  if (directId) {
    const preferredRegions = ["us", "cn", "jp", "hk", "gb"]
      .map((code) => REGIONS.find((region) => region.code === code))
      .filter(Boolean);
    regionalResults = await mapLimit(
      preferredRegions,
      5,
      (region) => lookupAppStorePage(directId, region, fetchImpl, deadlineSignal),
      deadlineSignal,
    );
    if (!regionalResults.some(Boolean)) {
      regionalResults = await mapLimit(
        REGIONS,
        5,
        (region) => lookupRegion(directId, region, fetchImpl, deadlineSignal),
        deadlineSignal,
      );
    }
  } else {
    const searchTargets = [
      { regionCode: "us", platform: "iphone" },
      { regionCode: "us", platform: "ipad" },
      { regionCode: "cn", platform: "iphone" },
      { regionCode: "hk", platform: "iphone" },
      { regionCode: "jp", platform: "iphone" },
    ];
    regionalResults = (await mapLimit(
      searchTargets,
      5,
      ({ regionCode, platform }) => searchAppStorePage(query, regionCode, platform, fetchImpl, deadlineSignal),
      deadlineSignal,
    )).flat();

    // Apple's legacy Search API has had intermittent outages. Keep it only as
    // a fallback so one Apple endpoint cannot make the entire search feature fail.
    if (!regionalResults.length) {
      regionalResults = (await mapLimit(
        REGIONS.slice(0, 5),
        5,
        (region) => searchRegion(query, region, fetchImpl, deadlineSignal),
        deadlineSignal,
      )).flat();
    }
  }

  const normalizedQuery = normalizeSearch(query);
  const deduplicated = new Map();
  for (const result of regionalResults.flat().filter(Boolean)) {
    const normalizedName = normalizeSearch(result.appName);
    const normalizedDeveloper = normalizeSearch(result.developer);
    const score = normalizedName === normalizedQuery
      ? 0
      : normalizedName.startsWith(normalizedQuery)
        ? 1
        : normalizedName.includes(normalizedQuery)
          ? 2
          : normalizedDeveloper === normalizedQuery
            ? 3
            : normalizedDeveloper.startsWith(normalizedQuery)
              ? 4
              : normalizedDeveloper.includes(normalizedQuery)
                ? 5
                : 9;
    const previous = deduplicated.get(result.appId);
    if (!previous || score < previous.score) deduplicated.set(result.appId, { ...result, score });
  }
  const rankedResults = [...deduplicated.values()];
  const hasTextMatch = rankedResults.some((result) => result.score < 9);
  return rankedResults
    .filter((result) => !hasTextMatch || result.score < 9)
    .sort((left, right) => left.score - right.score || left.appName.localeCompare(right.appName))
    .slice(0, 12)
    .map((result) => ({
      appId: result.appId,
      appName: result.appName,
      developer: result.developer,
      icon: result.icon,
      storeUrl: result.storeUrl,
      sourceRegion: result.sourceRegion,
    }));
}

async function inspectRegion(appId, region, fetchImpl, deadlineSignal) {
  const requestedUrl = `https://apps.apple.com/${region.code}/app/id${appId}?l=en`;
  try {
    const response = await appleRequest(requestedUrl, fetchImpl, [404], deadlineSignal);
    const resolvedUrl = response.url || requestedUrl;
    if (response.status === 404 || !new URL(resolvedUrl).pathname.includes(`id${appId}`)) {
      return {
        row: { region: region.code, status: "error:HTTP 404", itemCount: 0, items: [] },
        metadata: null,
      };
    }
    const extracted = extractAppStorePage(await readTextWithLimit(response, MAX_APP_PAGE_BYTES));
    return {
      row: {
        region: region.code,
        status: extracted.status,
        itemCount: extracted.items.length,
        items: extracted.items,
      },
      metadata: extracted.metadata,
    };
  } catch (error) {
    return {
      row: {
        region: region.code,
        status: `error:${publicError(error)}`,
        itemCount: 0,
        items: [],
      },
      metadata: null,
    };
  }
}

export async function compareAppleApp(appId, fetchImpl = fetch, deadlineSignal) {
  if (!/^\d{6,12}$/u.test(appId)) throw new Error("invalid-app-id");
  const inspected = await mapLimit(
    REGIONS,
    5,
    (region) => inspectRegion(appId, region, fetchImpl, deadlineSignal),
    deadlineSignal,
  );
  const completed = REGIONS.map((region, index) => inspected[index] ?? {
    row: {
      region: region.code,
      status: "error:request-budget-exhausted",
      itemCount: 0,
      items: [],
    },
    metadata: null,
  });
  const pageMetadata = completed.find((result) => result.metadata)?.metadata ?? null;
  const lookupMetadata = pageMetadata
    ? null
    : (await mapLimit(
      REGIONS.slice(0, 5),
      5,
      (region) => lookupRegion(appId, region, fetchImpl, deadlineSignal),
      deadlineSignal,
    )).find(Boolean);
  const metadata = pageMetadata ?? (lookupMetadata ? {
    matchedName: lookupMetadata.appName,
    developer: lookupMetadata.developer,
    icon: lookupMetadata.icon,
    storeUrl: lookupMetadata.storeUrl,
  } : null);

  return {
    generatedAt: new Date().toISOString(),
    regionCount: REGIONS.length,
    app: {
      query: metadata?.matchedName ?? appId,
      id: appId,
      matchedName: metadata?.matchedName ?? `App ${appId}`,
      developer: metadata?.developer ?? "Apple App Store",
      icon: metadata?.icon ?? null,
      storeUrl: metadata?.storeUrl ?? `https://apps.apple.com/us/app/id${appId}`,
      priceSource: "app-store",
      regions: completed.map((result) => result.row),
    },
  };
}

export async function retryTransientRegions(comparison, fetchImpl = fetch, deadlineSignal) {
  const appId = String(comparison?.app?.id ?? "");
  if (!/^\d{6,12}$/u.test(appId)) return comparison;
  const failedCodes = new Set(
    (comparison.app.regions ?? [])
      .filter(isTransientRegionError)
      .map((region) => region.region),
  );
  if (!failedCodes.size) return comparison;

  const targets = REGIONS.filter((region) => failedCodes.has(region.code));
  const retried = await mapLimit(
    targets,
    5,
    (region) => inspectRegion(appId, region, fetchImpl, deadlineSignal),
    deadlineSignal,
  );
  const replacements = new Map();
  targets.forEach((region, index) => {
    const row = retried[index]?.row;
    if (row) replacements.set(region.code, row);
  });
  return {
    ...comparison,
    generatedAt: new Date().toISOString(),
    app: {
      ...comparison.app,
      regions: comparison.app.regions.map((region) => replacements.get(region.region) ?? region),
    },
  };
}

function requestIsSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

function isTransientRegionError(region) {
  return region.status.startsWith("error:") && region.status !== "error:HTTP 404";
}

async function cachedJson(context, cacheUrl, edgeSeconds, browserSeconds, producer, shouldCache = () => true) {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const payload = await producer();
  const cacheable = shouldCache(payload);
  const response = jsonResponse(
    payload,
    200,
    cacheable
      ? `public, max-age=${browserSeconds}, s-maxage=${edgeSeconds}, stale-while-revalidate=3600`
      : "no-store",
  );
  if (cache && cacheable) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function privateStorage(context) {
  const storage = context.env?.PRICE_COMPARE_KV;
  return storage && typeof storage.get === "function" && typeof storage.put === "function"
    ? storage
    : null;
}

function privateCanonicalRequest(timestamp, method, pathname, body) {
  return `${timestamp}\n${method.toUpperCase()}\n${pathname}\n${body}`;
}

function bytesFromHex(value) {
  if (!/^[a-f0-9]{64}$/iu.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifyPrivateSignature(request, url, body, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const timestamp = request.headers.get("x-price-timestamp") ?? "";
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > PRIVATE_CLOCK_SKEW_SECONDS) {
    return false;
  }
  const signature = bytesFromHex(request.headers.get("x-price-signature") ?? "");
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(privateCanonicalRequest(timestamp, request.method, url.pathname, body)),
  );
}

async function readPrivateJson(storage, key) {
  try {
    const value = await storage.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn(JSON.stringify({ event: "private-cache-read-failed", key, error: String(error) }));
    return null;
  }
}

async function writePrivateJson(storage, key, value, expirationTtl = PRIVATE_STALE_SECONDS) {
  await storage.put(key, JSON.stringify(value), { expirationTtl });
}

async function privateRateAllowed(storage, now = Date.now()) {
  const key = `private:rate:${Math.floor(now / 60_000)}`;
  const current = Number(await storage.get(key) ?? 0);
  if (current >= PRIVATE_GLOBAL_REQUESTS_PER_MINUTE) return false;
  await storage.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}

function snapshotComparison(app) {
  return {
    generatedAt: validationSnapshot.generatedAt,
    regionCount: regionData.regions.length,
    app,
  };
}

function comparisonRecord(comparison) {
  const appId = String(comparison.app.id);
  return {
    storedAt: new Date().toISOString(),
    data: buildPrivateComparison(comparison, {
      curatedPlans: planDefinitions[appId] ?? [],
      exchangeRates,
      regions: regionData.regions,
    }),
  };
}

function snapshotCandidate(app, score) {
  return {
    appId: String(app.id),
    appName: app.matchedName ?? app.query ?? String(app.id),
    developer: app.developer ?? "",
    icon: app.icon ?? null,
    storeUrl: app.storeUrl ?? null,
    sourceRegion: "us",
    score,
  };
}

function searchSnapshot(query) {
  const directId = parseAppId(query) ?? String(query).trim();
  const exact = validationSnapshot.apps.find((app) => String(app.id) === directId);
  if (exact) return [snapshotCandidate(exact, 0)];
  const normalizedQuery = normalizeSearch(query);
  return validationSnapshot.apps
    .map((app) => {
      const name = normalizeSearch(app.matchedName ?? app.query);
      const developer = normalizeSearch(app.developer);
      const score = name === normalizedQuery
        ? 0
        : name.startsWith(normalizedQuery)
          ? 1
          : name.includes(normalizedQuery)
            ? 2
            : developer === normalizedQuery
              ? 3
              : developer.includes(normalizedQuery)
                ? 4
                : 9;
      return snapshotCandidate(app, score);
    })
    .filter((result) => result.score < 9)
    .sort((left, right) => left.score - right.score || left.appName.localeCompare(right.appName));
}

async function privateSearch(query, storage) {
  const normalizedQuery = normalizeSearch(query);
  const cacheKey = `private:search:v1:${normalizedQuery}`;
  const cached = await readPrivateJson(storage, cacheKey);
  if (cached) return { ...cached, cache: "hit" };

  const snapshotResults = searchSnapshot(query);
  let liveResults = [];
  if (!snapshotResults.some((result) => result.score === 0)) {
    liveResults = await searchAppleApps(query, fetch, AbortSignal.timeout(3_000));
  }
  const merged = new Map();
  for (const result of [...snapshotResults, ...liveResults]) {
    const appId = String(result.appId);
    if (!merged.has(appId)) merged.set(appId, result);
  }
  const payload = {
    query,
    results: [...merged.values()].slice(0, 3).map((result) => {
      const publicResult = { ...result };
      delete publicResult.score;
      return publicResult;
    }),
  };
  await writePrivateJson(storage, cacheKey, payload, 6 * 60 * 60);
  return { ...payload, cache: "miss" };
}

function recordAgeSeconds(record, now = Date.now()) {
  const generatedAt = Date.parse(record?.data?.generatedAt ?? "");
  return Number.isFinite(generatedAt) ? Math.max(0, Math.floor((now - generatedAt) / 1000)) : Number.POSITIVE_INFINITY;
}

export function classifyPrivateRefreshError(error) {
  return ["us-anchor-unavailable", "us-plans-unavailable"].includes(String(error?.message))
    ? "no-comparable-plans"
    : "refresh-failed";
}

async function startPrivateRefresh(context, storage, appId) {
  const lockKey = `private:lock:v1:${appId}`;
  if (await storage.get(lockKey)) return null;
  await storage.put(lockKey, crypto.randomUUID(), { expirationTtl: PRIVATE_REFRESH_LOCK_SECONDS });

  const cacheKey = `private:compare:v1:${appId}`;
  const initialPromise = compareAppleApp(appId, fetch, AbortSignal.timeout(TOTAL_REQUEST_TIMEOUT_MS))
    .then(async (comparison) => {
      const record = comparisonRecord(comparison);
      await writePrivateJson(storage, cacheKey, record);
      return { comparison, record };
    });

  const background = initialPromise
    .then(async ({ comparison, record }) => {
      if (!comparison.app.regions.some(isTransientRegionError)) return record;
      const retried = await retryTransientRegions(comparison, fetch, AbortSignal.timeout(10_000));
      const retriedRecord = comparisonRecord(retried);
      await writePrivateJson(storage, cacheKey, retriedRecord);
      return retriedRecord;
    })
    .catch((error) => {
      console.error(JSON.stringify({ event: "private-compare-refresh-failed", appId, error: String(error) }));
      return null;
    })
    .finally(async () => {
      try {
        await storage.delete(lockKey);
      } catch (error) {
        console.warn(JSON.stringify({ event: "private-lock-release-failed", appId, error: String(error) }));
      }
    });
  context.waitUntil(background);
  return {
    initial: initialPromise
      .then(({ record }) => record)
      .catch((error) => ({
        error: classifyPrivateRefreshError(error),
      })),
  };
}

async function privateCompare(context, storage, target, refreshMode) {
  const snapshotApp = validationSnapshot.apps.find((app) => String(app.id) === String(target));
  const appId = snapshotApp ? String(snapshotApp.id) : parseAppId(target);
  if (!appId) return { status: 400, payload: { error: "invalid-app-id" } };
  const cacheKey = `private:compare:v1:${appId}`;
  let record = await readPrivateJson(storage, cacheKey);

  if (snapshotApp) {
    const seeded = comparisonRecord(snapshotComparison(snapshotApp));
    const snapshotAge = recordAgeSeconds(seeded);
    if (snapshotAge <= PRIVATE_STALE_SECONDS && (!record || Date.parse(seeded.data.generatedAt) > Date.parse(record.data?.generatedAt ?? ""))) {
      record = seeded;
      await writePrivateJson(storage, cacheKey, record);
    }
  }

  let age = recordAgeSeconds(record);
  if (record && age > PRIVATE_STALE_SECONDS) {
    record = null;
    age = Number.POSITIVE_INFINITY;
  }
  const numericAppId = /^\d{6,12}$/u.test(appId);
  let shouldRefresh = numericAppId && age > PRIVATE_FRESH_SECONDS;
  if (refreshMode === "hot") shouldRefresh = numericAppId && age > PRIVATE_HOT_REFRESH_SECONDS;
  if (refreshMode === "manual") {
    const manualKey = `private:manual:v1:${appId}`;
    const lastManual = Number(await storage.get(manualKey) ?? 0);
    shouldRefresh = numericAppId && Date.now() - lastManual >= PRIVATE_MANUAL_REFRESH_SECONDS * 1000;
    if (shouldRefresh) await storage.put(manualKey, String(Date.now()), { expirationTtl: PRIVATE_MANUAL_REFRESH_SECONDS });
  }

  if (record && age <= PRIVATE_FRESH_SECONDS && refreshMode !== "hot" && refreshMode !== "manual") {
    return { status: 200, payload: { status: "ready", cache: "fresh", data: record.data } };
  }

  if (record) {
    if (shouldRefresh) await startPrivateRefresh(context, storage, appId);
    return {
      status: 200,
      payload: {
        status: "ready",
        cache: age <= PRIVATE_FRESH_SECONDS ? "fresh" : "stale",
        refreshStarted: shouldRefresh,
        data: record.data,
      },
    };
  }

  if (!numericAppId) {
    return snapshotApp
      ? { status: 503, payload: { error: "snapshot-too-old" } }
      : { status: 422, payload: { error: "no-comparable-plans" } };
  }
  const refresh = await startPrivateRefresh(context, storage, appId);
  if (!refresh) return { status: 202, payload: { status: "pending", retryAfter: 30 } };
  const pending = Symbol("private-pending");
  const result = await Promise.race([
    refresh.initial,
    new Promise((resolve) => setTimeout(() => resolve(pending), PRIVATE_INITIAL_WAIT_MS)),
  ]);
  if (result === pending || !result) return { status: 202, payload: { status: "pending", retryAfter: 30 } };
  if (result.error === "no-comparable-plans") {
    return { status: 422, payload: { error: "no-comparable-plans" } };
  }
  if (result.error) {
    return { status: 502, payload: { error: "refresh-failed", retryAfter: 30 } };
  }
  return { status: 200, payload: { status: "ready", cache: "miss", data: result.data } };
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const path = Array.isArray(context.params.path) ? context.params.path : [context.params.path].filter(Boolean);
  if (path[0] !== "private") {
    return jsonResponse({ error: "请求方法不受支持" }, 405, "no-store", { allow: "GET" });
  }

  let body;
  try {
    body = await readTextWithLimit(context.request, PRIVATE_BODY_BYTES);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error && error.message === "response-too-large" ? "request-too-large" : "invalid-request" },
      error instanceof Error && error.message === "response-too-large" ? 413 : 400,
    );
  }
  const secret = context.env?.PRICE_COMPARE_API_SECRET;
  if (!secret) return jsonResponse({ error: "private-api-not-configured" }, 503);
  if (!await verifyPrivateSignature(context.request, url, body, secret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const storage = privateStorage(context);
  if (!storage) return jsonResponse({ error: "private-storage-not-configured" }, 503);

  let input;
  try {
    input = body ? JSON.parse(body) : {};
  } catch {
    return jsonResponse({ error: "invalid-json" }, 400);
  }

  if (path[1] === "health" && path.length === 2) {
    return jsonResponse({ ok: true, storage: true, snapshotAt: validationSnapshot.generatedAt });
  }
  if (!await privateRateAllowed(storage)) {
    return jsonResponse({ error: "rate-limited" }, 429, "no-store", { "retry-after": "60" });
  }

  try {
    if (path[1] === "search" && path.length === 2) {
      const query = String(input.query ?? "").trim();
      if (query.length < 2 || query.length > 200) return jsonResponse({ error: "invalid-query" }, 400);
      return jsonResponse(await privateSearch(query, storage));
    }
    if (path[1] === "compare" && path.length === 2) {
      const result = await privateCompare(context, storage, String(input.target ?? "").trim(), input.refresh);
      return jsonResponse(result.payload, result.status, "no-store", result.status === 202 ? { "retry-after": "30" } : {});
    }
    return jsonResponse({ error: "private-endpoint-not-found" }, 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "us-anchor-unavailable" || code === "us-plans-unavailable") {
      return jsonResponse({ error: "no-comparable-plans" }, 422);
    }
    console.error(JSON.stringify({ event: "private-api-failed", path: url.pathname, error: code }));
    return jsonResponse({ error: "private-api-failed" }, 502, "no-store", { "retry-after": "30" });
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const deadlineSignal = AbortSignal.timeout(TOTAL_REQUEST_TIMEOUT_MS);
  if (!requestIsSameOrigin(context.request, url)) {
    console.warn(JSON.stringify({
      event: "custom-app-request-blocked",
      requestId,
      path: url.pathname,
      reason: "cross-origin",
    }));
    return jsonResponse({ error: "仅支持本站调用" }, 403, "no-store", { "x-request-id": requestId });
  }

  const path = Array.isArray(context.params.path) ? context.params.path : [context.params.path].filter(Boolean);
  try {
    if (path[0] === "search" && path.length === 1) {
      const query = String(url.searchParams.get("q") ?? "").trim();
      if (query.length < 2 || query.length > 80) {
        return jsonResponse({ error: "请输入 2–80 个字符的应用名称、App ID 或 App Store 链接" }, 400);
      }
      const cacheUrl = new URL("/api/apps/search", url.origin);
      cacheUrl.searchParams.set("q", normalizeSearch(query));
      cacheUrl.searchParams.set("v", "4");
      return cachedJson(context, cacheUrl, 21_600, 300, async () => ({
        query,
        regions: REGIONS.map(({ code, name }) => ({ code, name })),
        results: await searchAppleApps(query, fetch, deadlineSignal),
      }));
    }

    if (path[0] === "compare" && path.length === 2) {
      const appId = String(path[1] ?? "");
      if (!/^\d{6,12}$/u.test(appId)) return jsonResponse({ error: "App ID 格式不正确" }, 400);
      const cacheUrl = new URL(`/api/apps/compare/${appId}`, url.origin);
      return cachedJson(context, cacheUrl, 43_200, 600, async () => {
        const comparison = await compareAppleApp(appId, fetch, deadlineSignal);
        const degradedRegions = comparison.app.regions.filter(isTransientRegionError);
        if (degradedRegions.length) {
          console.warn(JSON.stringify({
            event: "custom-app-compare-degraded",
            requestId,
            appId,
            degradedRegionCount: degradedRegions.length,
            elapsedMs: Date.now() - startedAt,
          }));
        }
        return comparison;
      }, (comparison) => !comparison.app.regions.some(isTransientRegionError));
    }

    return jsonResponse({ error: "接口不存在" }, 404, "no-store", { "x-request-id": requestId });
  } catch (error) {
    console.error(JSON.stringify({
      event: "custom-app-query-failed",
      requestId,
      path: url.pathname,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonResponse(
      { error: publicError(error) },
      502,
      "no-store",
      { "retry-after": "3", "x-request-id": requestId },
    );
  }
}

export function onRequest() {
  return jsonResponse(
    { error: "请求方法不受支持" },
    405,
    "no-store",
    {
      allow: "GET",
      "x-request-id": crypto.randomUUID(),
    },
  );
}
