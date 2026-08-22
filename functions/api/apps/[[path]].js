import exchangeRates from "../../generated/exchange-rates.mjs";
import planDefinitions from "../../generated/plan-definitions.mjs";
import regionData from "../../generated/regions.mjs";
import validationSnapshot from "../../generated/validation-snapshot.mjs";
import { buildPrivateComparison } from "../../lib/private-comparison.js";
import { appleCatalogAppUrl, extractAppleCatalog } from "../../../app/lib/apple-catalog.mjs";

export const REGIONS = regionData.regions.map(({ code, name }) => ({ code, name }));

const START_MARKER = '<script type="application/json" id="serialized-server-data">';
const END_MARKER = "</script>";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36";
const MAX_APP_PAGE_BYTES = 6_000_000;
const MAX_JSON_BYTES = 1_000_000;
const TOTAL_REQUEST_TIMEOUT_MS = 18_000;
const PRIVATE_BODY_BYTES = 4_096;
const PRIVATE_CLOCK_SKEW_SECONDS = 300;
const PRIVATE_API_VERSION = 1;
const PRIVATE_SEARCH_TIMEOUT_MS = 2_500;
const PRIVATE_FRESH_SECONDS = 12 * 60 * 60;
const PRIVATE_STALE_SECONDS = 7 * 24 * 60 * 60;
const PRIVATE_HOT_REFRESH_SECONDS = 3 * 60 * 60;
const PRIVATE_MANUAL_REFRESH_SECONDS = 30 * 60;
const PRIVATE_NEGATIVE_SECONDS = 6 * 60 * 60;
const PRIVATE_FAILED_SECONDS = 60;
const PRIVATE_GLOBAL_REQUESTS_PER_MINUTE = 60;
const PRIVATE_MATCHING_VERSION = 5;
const TRANSIENT_REGION_RETRY_LIMIT = 3;
// Cloudflare KV rejects expirationTtl values below 60 seconds.
const PRIVATE_REFRESH_LOCK_SECONDS = 60;

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

async function appleRequest(url, fetchImpl = fetch, acceptedStatuses = [], deadlineSignal, extraHeaders = {}) {
  const signal = deadlineSignal
    ? AbortSignal.any([deadlineSignal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": USER_AGENT,
      ...extraHeaders,
    },
    redirect: "follow",
    signal,
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function appleJson(url, fetchImpl = fetch, deadlineSignal, extraHeaders = {}) {
  const response = await appleRequest(url, fetchImpl, [], deadlineSignal, extraHeaders);
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

async function searchRegion(query, region, fetchImpl, deadlineSignal, limit = 8) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("country", region.code);
  url.searchParams.set("media", "software");
  url.searchParams.set("entity", "software");
  url.searchParams.set("limit", String(limit));
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
  let identityStatus = null;
  try {
    const catalogUrl = appleCatalogAppUrl(appId, region.code);
    const payload = await appleJson(catalogUrl, fetchImpl, deadlineSignal, {
      referer: requestedUrl,
    });
    const extracted = extractAppleCatalog(payload, appId);
    if (extracted.status === "ok-structured") {
      return {
        row: {
          region: region.code,
          status: extracted.status,
          itemCount: extracted.items.length,
          items: extracted.items,
        },
        metadata: extracted.metadata,
      };
    }
    identityStatus = extracted.status;
  } catch (error) {
    identityStatus = `error:${publicError(error)}`;
  }

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
        ...(identityStatus ? { identityStatus } : {}),
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
        ...(identityStatus ? { identityStatus } : {}),
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
  let lookupMetadata = null;
  if (!pageMetadata?.icon) {
    const preferredRegions = ["us", "cn", "jp", "hk", "gb"]
      .map((code) => REGIONS.find((region) => region.code === code))
      .filter(Boolean);
    if (pageMetadata && preferredRegions[0]) {
      const metadataSignal = deadlineSignal
        ? AbortSignal.any([deadlineSignal, AbortSignal.timeout(2_500)])
        : AbortSignal.timeout(2_500);
      lookupMetadata = await lookupRegion(appId, preferredRegions[0], fetchImpl, metadataSignal);
    } else if (preferredRegions.length) {
      lookupMetadata = (await mapLimit(
        preferredRegions,
        5,
        (region) => lookupRegion(appId, region, fetchImpl, deadlineSignal),
        deadlineSignal,
      )).find(Boolean);
    }
  }
  const metadata = pageMetadata || lookupMetadata ? {
    matchedName: pageMetadata?.matchedName ?? lookupMetadata?.appName,
    developer: pageMetadata?.developer || lookupMetadata?.developer || "",
    icon: pageMetadata?.icon ?? lookupMetadata?.icon ?? null,
    storeUrl: pageMetadata?.storeUrl ?? lookupMetadata?.storeUrl ?? null,
  } : null;

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
  if (targets.length > TRANSIENT_REGION_RETRY_LIMIT) return comparison;
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
  const status = String(region?.status ?? "");
  return (status.startsWith("error:") && status !== "error:HTTP 404")
    || status === "marker-missing"
    || status === "marker-unclosed";
}

function isIdentityDegradedRegion(region) {
  return region?.status !== "ok-structured" && Boolean(region?.identityStatus);
}

function privateApiPayload(payload) {
  return { ...payload, apiVersion: PRIVATE_API_VERSION };
}

export async function retryUsAnchor(comparison, fetchImpl = fetch, deadlineSignal) {
  const appId = String(comparison?.app?.id ?? "");
  const usRow = comparison?.app?.regions?.find((region) => region.region === "us");
  if (
    !/^\d{6,12}$/u.test(appId)
    || (!isTransientRegionError(usRow) && !isIdentityDegradedRegion(usRow))
  ) return comparison;
  const usRegion = REGIONS.find((region) => region.code === "us");
  if (!usRegion) return comparison;
  const retried = await inspectRegion(appId, usRegion, fetchImpl, deadlineSignal);
  return {
    ...comparison,
    generatedAt: new Date().toISOString(),
    app: {
      ...comparison.app,
      regions: comparison.app.regions.map((region) => (
        region.region === "us" ? retried.row : region
      )),
    },
  };
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

function comparisonRecord(comparison, { source = "live" } = {}) {
  const appId = String(comparison.app.id);
  const regions = Array.isArray(comparison.app.regions) ? comparison.app.regions : [];
  const usRow = regions.find((region) => region.region === "us");
  return {
    storedAt: new Date().toISOString(),
    source,
    diagnostics: {
      usStatus: usRow?.status ?? "missing",
      usIdentityStatus: usRow?.identityStatus ?? null,
      structuredRegionCount: regions.filter((region) => region.status === "ok-structured").length,
    },
    data: buildPrivateComparison(comparison, {
      curatedPlans: planDefinitions[appId] ?? [],
      exchangeRates,
      regions: regionData.regions,
    }),
  };
}

function logComparisonReview(record) {
  const review = record?.data?.review;
  if (!review?.excludedMatchCount) return;
  console.warn(JSON.stringify({
    event: "private-compare-match-review",
    appId: record.data.app.id,
    appName: record.data.app.name,
    excludedMatchCount: review.excludedMatchCount,
    affectedRegionCount: review.affectedRegionCount,
    reasons: [...new Set(review.issues.map((issue) => issue.reason))],
  }));
}

function curatedDuplicatePlanIds(appId) {
  const definitions = planDefinitions[String(appId)] ?? [];
  const aliases = new Map();
  for (const definition of definitions) {
    for (const alias of definition.aliases ?? []) {
      aliases.set(alias, (aliases.get(alias) ?? 0) + 1);
    }
  }
  return new Set(definitions
    .filter((definition) => (definition.aliases ?? []).some((alias) => (aliases.get(alias) ?? 0) > 1))
    .map((definition) => definition.id));
}

export function comparisonIdentitySummary(record, appId = record?.data?.app?.id) {
  const plans = Array.isArray(record?.data?.plans) ? record.data.plans : [];
  const duplicatePlanIds = curatedDuplicatePlanIds(appId);
  const unresolvedCuratedPlans = plans.filter((plan) => (
    duplicatePlanIds.has(plan.id)
    && (
      !plan.productId
      || plan.period === "公开项目"
      || plan.matchMethod === "us-anchor-only"
      || plan.matchMethod === "unmatched"
    )
  ));
  return {
    planCount: plans.length,
    structuredPlanCount: plans.filter((plan) => Boolean(plan.productId)).length,
    unresolvedCuratedPlanCount: unresolvedCuratedPlans.length,
    unresolvedCuratedPlanIds: unresolvedCuratedPlans.map((plan) => plan.id),
    source: record?.source ?? "unknown",
    usStatus: record?.diagnostics?.usStatus ?? "unknown",
    usIdentityStatus: record?.diagnostics?.usIdentityStatus ?? null,
  };
}

function comparisonRecordUsable(record, appId) {
  if (!record?.data || comparisonSnapshotIsIncomplete(record)) return false;
  return comparisonIdentitySummary(record, appId).unresolvedCuratedPlanCount === 0;
}

export function selectPrivateRefreshRecord(previousRecord, candidateRecord, appId) {
  const previous = comparisonIdentitySummary(previousRecord, appId);
  const candidate = comparisonIdentitySummary(candidateRecord, appId);
  const previousUsable = comparisonRecordUsable(previousRecord, appId);

  if (candidate.unresolvedCuratedPlanCount > 0) {
    return {
      action: previousUsable ? "retain" : "reject",
      reason: "curated-identity-degraded",
      record: previousUsable ? previousRecord : null,
      previous,
      candidate,
    };
  }
  if (
    previousUsable
    && previous.structuredPlanCount > 0
    && candidate.structuredPlanCount === 0
  ) {
    return {
      action: "retain",
      reason: "structured-identity-regressed",
      record: previousRecord,
      previous,
      candidate,
    };
  }
  return {
    action: "accept",
    reason: "identity-quality-accepted",
    record: candidateRecord,
    previous,
    candidate,
  };
}

function logPrivateRefreshDecision(appId, phase, decision) {
  const payload = {
    event: decision.action === "accept"
      ? "private-compare-refresh-accepted"
      : "private-compare-refresh-degraded",
    appId,
    phase,
    action: decision.action,
    reason: decision.reason,
    previous: decision.previous,
    candidate: decision.candidate,
  };
  const output = JSON.stringify(payload);
  if (decision.action === "accept") console.log(output);
  else console.warn(output);
}

async function persistPrivateRefreshRecord(storage, cacheKey, previousRecord, candidateRecord, appId, phase) {
  const decision = selectPrivateRefreshRecord(previousRecord, candidateRecord, appId);
  logPrivateRefreshDecision(appId, phase, decision);
  if (decision.action === "reject") {
    const error = new Error("identity-degraded");
    error.privateComparisonError = "refresh-failed";
    throw error;
  }
  if (decision.action === "accept") await writePrivateJson(storage, cacheKey, candidateRecord);
  return { record: decision.record, retained: decision.action === "retain" };
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

export async function privateSearch(query, storage, fetchImpl = fetch) {
  const normalizedQuery = normalizeSearch(query);
  const cacheKey = `private:search:v2:${normalizedQuery}`;
  const cached = await readPrivateJson(storage, cacheKey);
  if (cached) return { ...cached, cache: "hit" };

  const snapshotResults = searchSnapshot(query);
  let selected = snapshotResults.find((result) => result.score === 0) ?? null;
  if (!selected) {
    // Keep name resolution identical to the bot's existing App detail and IAP
    // commands: use Apple's US Search API and trust its first result. The
    // App Store web search is only a same-region fallback for a transient
    // Search API outage; it must not turn the reply into a candidate picker.
    const usRegion = REGIONS.find((region) => region.code === "us");
    const searchSignal = AbortSignal.timeout(PRIVATE_SEARCH_TIMEOUT_MS);
    const [searchResults, fallbackResults] = await Promise.all([
      usRegion ? searchRegion(query, usRegion, fetchImpl, searchSignal, 1) : [],
      searchAppStorePage(query, "us", "iphone", fetchImpl, searchSignal),
    ]);
    selected = searchResults[0] ?? fallbackResults[0] ?? null;
  }
  const payload = {
    query,
    results: (selected ? [selected] : []).map((result) => {
      const publicResult = { ...result };
      delete publicResult.score;
      return publicResult;
    }),
  };
  // Do not preserve a transient Apple outage as a six-hour "not found" result.
  await writePrivateJson(storage, cacheKey, payload, selected ? 6 * 60 * 60 : 60);
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

function comparisonNeedsIdentityRefresh(record) {
  return (record?.data?.plans ?? []).some((plan) => (
    plan.matchMethod === "us-anchor-only"
    || (record?.source === "snapshot" && !plan.productId)
  ));
}

function comparisonSnapshotIsIncomplete(record) {
  return record?.source === "snapshot"
    && (record?.data?.plans ?? []).some((plan) => !plan.productId);
}

export function classifyComparisonResultError(comparison, error) {
  const fallback = classifyPrivateRefreshError(error);
  if (fallback !== "no-comparable-plans") return fallback;
  const rows = Array.isArray(comparison?.app?.regions) ? comparison.app.regions : [];
  const usRow = rows.find((region) => region.region === "us");
  const hasAnyItems = rows.some((region) => Array.isArray(region.items) && region.items.length > 0);
  if (usRow?.status === "iap-section-missing" && !hasAnyItems) return "no-in-app-purchases";
  if (
    usRow?.status === "error:HTTP 404"
    || usRow?.status === "iap-section-missing"
    || (String(usRow?.status ?? "").startsWith("ok-") && Array.isArray(usRow.items) && usRow.items.length > 0)
  ) {
    return "no-comparable-plans";
  }
  return "refresh-failed";
}

async function startPrivateRefresh(context, storage, appId) {
  const lockKey = `private:lock:v1:${appId}`;
  if (await storage.get(lockKey)) return null;
  await storage.put(lockKey, crypto.randomUUID(), { expirationTtl: PRIVATE_REFRESH_LOCK_SECONDS });

  const cacheKey = `private:compare:v${PRIVATE_MATCHING_VERSION}:${appId}`;
  const previousRecord = await readPrivateJson(storage, cacheKey);
  const initialPromise = compareAppleApp(appId, fetch, AbortSignal.timeout(TOTAL_REQUEST_TIMEOUT_MS))
    .then(async (comparison) => retryUsAnchor(comparison, fetch, AbortSignal.timeout(8_000)))
    .then(async (comparison) => {
      try {
        const candidateRecord = comparisonRecord(comparison);
        logComparisonReview(candidateRecord);
        const persisted = await persistPrivateRefreshRecord(
          storage,
          cacheKey,
          previousRecord,
          candidateRecord,
          appId,
          "initial",
        );
        return { comparison, ...persisted };
      } catch (error) {
        const classified = classifyComparisonResultError(comparison, error);
        if (error && typeof error === "object") error.privateComparisonError = classified;
        if (comparisonRecordUsable(previousRecord, appId)) {
          console.warn(JSON.stringify({
            event: "private-compare-refresh-failure-retained",
            appId,
            phase: "initial",
            error: classified,
            previous: comparisonIdentitySummary(previousRecord, appId),
          }));
          return { comparison, record: previousRecord, retained: true };
        }
        if (classified !== "refresh-failed") {
          await writePrivateJson(storage, cacheKey, {
            storedAt: new Date().toISOString(),
            error: classified,
          }, PRIVATE_NEGATIVE_SECONDS);
        }
        throw error;
      }
    });

  const background = initialPromise
    .then(async ({ comparison, record, retained }) => {
      if (retained || !comparison.app.regions.some(isTransientRegionError)) return record;
      const retried = await retryTransientRegions(comparison, fetch, AbortSignal.timeout(10_000));
      const candidateRecord = comparisonRecord(retried);
      logComparisonReview(candidateRecord);
      return (await persistPrivateRefreshRecord(
        storage,
        cacheKey,
        record,
        candidateRecord,
        appId,
        "transient-region-retry",
      )).record;
    })
    .catch(async (error) => {
      const classified = error?.privateComparisonError ?? classifyPrivateRefreshError(error);
      if (classified === "refresh-failed" && !comparisonRecordUsable(previousRecord, appId)) {
        // A failed detached crawl must reach a terminal state. Otherwise every
        // retry starts another crawl and the user remains in an endless pending loop.
        try {
          await writePrivateJson(storage, cacheKey, {
            storedAt: new Date().toISOString(),
            error: classified,
          }, PRIVATE_FAILED_SECONDS);
        } catch (storageError) {
          console.warn(JSON.stringify({
            event: "private-refresh-error-cache-failed",
            appId,
            error: String(storageError),
          }));
        }
      } else if (comparisonRecordUsable(previousRecord, appId)) {
        console.warn(JSON.stringify({
          event: "private-compare-refresh-failure-retained",
          appId,
          phase: "background",
          error: classified,
          previous: comparisonIdentitySummary(previousRecord, appId),
        }));
      }
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

function queuePrivateRefresh(context, storage, appId) {
  const queued = startPrivateRefresh(context, storage, appId).catch((error) => {
    console.error(JSON.stringify({ event: "private-refresh-start-failed", appId, error: String(error) }));
    return null;
  });
  context.waitUntil(queued);
}

async function privateCompare(context, storage, target, refreshMode) {
  const snapshotApp = validationSnapshot.apps.find((app) => String(app.id) === String(target));
  const appId = snapshotApp ? String(snapshotApp.id) : parseAppId(target);
  if (!appId) return { status: 400, payload: { error: "invalid-app-id" } };
  const cacheKey = `private:compare:v${PRIVATE_MATCHING_VERSION}:${appId}`;
  let record = await readPrivateJson(storage, cacheKey);

  if (snapshotApp) {
    const seeded = comparisonRecord(snapshotComparison(snapshotApp), { source: "snapshot" });
    const snapshotAge = recordAgeSeconds(seeded);
    if (snapshotAge <= PRIVATE_STALE_SECONDS && (!record || Date.parse(seeded.data.generatedAt) > Date.parse(record.data?.generatedAt ?? ""))) {
      record = seeded;
      await writePrivateJson(storage, cacheKey, record);
    }
  }

  if (record?.data && !comparisonRecordUsable(record, appId)) {
    console.warn(JSON.stringify({
      event: "private-compare-cache-degraded",
      appId,
      cached: comparisonIdentitySummary(record, appId),
    }));
    record = null;
  }

  if (record?.error) {
    if (refreshMode !== "manual") {
      return {
        status: record.error === "refresh-failed" ? 503 : 422,
        payload: { error: record.error },
      };
    }
    record = null;
  }

  let age = recordAgeSeconds(record);
  if (record && age > PRIVATE_STALE_SECONDS) {
    record = null;
    age = Number.POSITIVE_INFINITY;
  }
  const numericAppId = /^\d{6,12}$/u.test(appId);
  const needsIdentityRefresh = comparisonNeedsIdentityRefresh(record);
  const incompleteSnapshot = comparisonSnapshotIsIncomplete(record);
  let shouldRefresh = numericAppId && (
    age > PRIVATE_FRESH_SECONDS
    || incompleteSnapshot
    || (needsIdentityRefresh && age > PRIVATE_HOT_REFRESH_SECONDS)
  );
  if (refreshMode === "hot") shouldRefresh = numericAppId && age > PRIVATE_HOT_REFRESH_SECONDS;
  if (refreshMode === "manual") {
    const manualKey = `private:manual:v1:${appId}`;
    const lastManual = Number(await storage.get(manualKey) ?? 0);
    shouldRefresh = numericAppId && Date.now() - lastManual >= PRIVATE_MANUAL_REFRESH_SECONDS * 1000;
    if (shouldRefresh) await storage.put(manualKey, String(Date.now()), { expirationTtl: PRIVATE_MANUAL_REFRESH_SECONDS });
  }

  if (record && incompleteSnapshot) {
    // A legacy HTML snapshot has useful prices but no stable product identity.
    // Never expose it as a completed comparison: refresh the Apple catalog in
    // the background and let the caller retry with a bounded pending response.
    if (numericAppId) queuePrivateRefresh(context, storage, appId);
    return { status: 202, payload: { status: "pending", retryAfter: 30 } };
  }

  if (
    record
    && age <= PRIVATE_FRESH_SECONDS
    && !shouldRefresh
    && refreshMode !== "hot"
    && refreshMode !== "manual"
  ) {
    return { status: 200, payload: { status: "ready", cache: "fresh", data: record.data } };
  }

  if (record) {
    // A refresh failure must never hide a usable cached snapshot from callers.
    if (shouldRefresh) queuePrivateRefresh(context, storage, appId);
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
  // Cold crawls are deliberately detached: callers get a bounded response and
  // can retry while the background job fills KV.
  queuePrivateRefresh(context, storage, appId);
  return { status: 202, payload: { status: "pending", retryAfter: 30 } };
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

  const endpointPath = path[1] === `v${PRIVATE_API_VERSION}` ? path.slice(2) : path.slice(1);

  let input;
  try {
    input = body ? JSON.parse(body) : {};
  } catch {
    return jsonResponse({ error: "invalid-json" }, 400);
  }

  if (endpointPath[0] === "health" && endpointPath.length === 1) {
    return jsonResponse(privateApiPayload({
      ok: true,
      storage: true,
      snapshotAt: validationSnapshot.generatedAt,
      matchingVersion: PRIVATE_MATCHING_VERSION,
    }));
  }
  if (!await privateRateAllowed(storage)) {
    return jsonResponse({ error: "rate-limited" }, 429, "no-store", { "retry-after": "60" });
  }

  try {
    if (endpointPath[0] === "search" && endpointPath.length === 1) {
      const query = String(input.query ?? "").trim();
      if (query.length < 2 || query.length > 200) return jsonResponse({ error: "invalid-query" }, 400);
      return jsonResponse(privateApiPayload(await privateSearch(query, storage)));
    }
    if (endpointPath[0] === "compare" && endpointPath.length === 1) {
      const result = await privateCompare(context, storage, String(input.target ?? "").trim(), input.refresh);
      return jsonResponse(
        privateApiPayload(result.payload),
        result.status,
        "no-store",
        result.status === 202 ? { "retry-after": "30" } : {},
      );
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
      cacheUrl.searchParams.set("v", "5");
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
      cacheUrl.searchParams.set("v", "5");
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
