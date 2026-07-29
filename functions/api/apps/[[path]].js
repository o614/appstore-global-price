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

function jsonResponse(payload, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
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

async function appleRequest(url, fetchImpl = fetch, acceptedStatuses = []) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function appleJson(url, fetchImpl = fetch) {
  const response = await appleRequest(url, fetchImpl);
  return JSON.parse(await readTextWithLimit(response, MAX_JSON_BYTES));
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

function normalizeSearch(value) {
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

async function searchRegion(query, region, fetchImpl) {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("country", region.code);
  url.searchParams.set("media", "software");
  url.searchParams.set("entity", "software");
  url.searchParams.set("limit", "8");
  try {
    const payload = await appleJson(url, fetchImpl);
    return (payload.results ?? [])
      .map((item) => appSearchResult(item, region.code))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function searchAppStorePage(query, regionCode, platform, fetchImpl) {
  const url = new URL(`https://apps.apple.com/${regionCode}/${platform}/search`);
  url.searchParams.set("term", query);
  try {
    const response = await appleRequest(url, fetchImpl);
    return extractAppSearchPage(
      await readTextWithLimit(response, MAX_APP_PAGE_BYTES),
      regionCode,
    );
  } catch {
    return [];
  }
}

async function lookupRegion(appId, region, fetchImpl) {
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", appId);
  url.searchParams.set("country", region.code);
  url.searchParams.set("entity", "software");
  try {
    const payload = await appleJson(url, fetchImpl);
    return (payload.results ?? [])
      .map((item) => appSearchResult(item, region.code))
      .find((item) => item?.appId === appId) ?? null;
  } catch {
    return null;
  }
}

async function lookupAppStorePage(appId, region, fetchImpl) {
  const requestedUrl = `https://apps.apple.com/${region.code}/app/id${appId}?l=en`;
  try {
    const response = await appleRequest(requestedUrl, fetchImpl, [404]);
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

export async function searchAppleApps(query, fetchImpl = fetch) {
  const directId = parseAppId(query);
  let regionalResults;
  if (directId) {
    const preferredRegions = ["us", "cn", "jp", "hk", "gb"]
      .map((code) => REGIONS.find((region) => region.code === code))
      .filter(Boolean);
    regionalResults = await mapLimit(
      preferredRegions,
      5,
      (region) => lookupAppStorePage(directId, region, fetchImpl),
    );
    if (!regionalResults.some(Boolean)) {
      regionalResults = await mapLimit(REGIONS, 5, (region) => lookupRegion(directId, region, fetchImpl));
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
      ({ regionCode, platform }) => searchAppStorePage(query, regionCode, platform, fetchImpl),
    )).flat();

    // Apple's legacy Search API has had intermittent outages. Keep it only as
    // a fallback so one Apple endpoint cannot make the entire search feature fail.
    if (!regionalResults.length) {
      regionalResults = (await mapLimit(
        REGIONS.slice(0, 5),
        5,
        (region) => searchRegion(query, region, fetchImpl),
      )).flat();
    }
  }

  const normalizedQuery = normalizeSearch(query);
  const deduplicated = new Map();
  for (const result of regionalResults.flat().filter(Boolean)) {
    const scoreName = normalizeSearch(result.appName);
    const score = scoreName === normalizedQuery ? 0 : scoreName.startsWith(normalizedQuery) ? 1 : scoreName.includes(normalizedQuery) ? 2 : 3;
    const previous = deduplicated.get(result.appId);
    if (!previous || score < previous.score) deduplicated.set(result.appId, { ...result, score });
  }
  return [...deduplicated.values()]
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

async function inspectRegion(appId, region, fetchImpl) {
  const requestedUrl = `https://apps.apple.com/${region.code}/app/id${appId}?l=en`;
  try {
    const response = await appleRequest(requestedUrl, fetchImpl, [404]);
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

export async function compareAppleApp(appId, fetchImpl = fetch) {
  if (!/^\d{6,12}$/u.test(appId)) throw new Error("invalid-app-id");
  const inspected = await mapLimit(REGIONS, 5, (region) => inspectRegion(appId, region, fetchImpl));
  const pageMetadata = inspected.find((result) => result.metadata)?.metadata ?? null;
  const lookupMetadata = pageMetadata
    ? null
    : (await mapLimit(REGIONS.slice(0, 5), 5, (region) => lookupRegion(appId, region, fetchImpl))).find(Boolean);
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
      regions: inspected.map((result) => result.row),
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

async function cachedJson(context, cacheUrl, edgeSeconds, browserSeconds, producer) {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const payload = await producer();
  const response = jsonResponse(
    payload,
    200,
    `public, max-age=${browserSeconds}, s-maxage=${edgeSeconds}, stale-while-revalidate=3600`,
  );
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (!requestIsSameOrigin(context.request, url)) {
    return jsonResponse({ error: "仅支持本站调用" }, 403);
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
      cacheUrl.searchParams.set("v", "3");
      return cachedJson(context, cacheUrl, 21_600, 300, async () => ({
        query,
        regions: REGIONS.map(({ code, name }) => ({ code, name })),
        results: await searchAppleApps(query),
      }));
    }

    if (path[0] === "compare" && path.length === 2) {
      const appId = String(path[1] ?? "");
      if (!/^\d{6,12}$/u.test(appId)) return jsonResponse({ error: "App ID 格式不正确" }, 400);
      const cacheUrl = new URL(`/api/apps/compare/${appId}`, url.origin);
      return cachedJson(context, cacheUrl, 43_200, 600, () => compareAppleApp(appId));
    }

    return jsonResponse({ error: "接口不存在" }, 404);
  } catch (error) {
    console.error(JSON.stringify({
      event: "custom-app-query-failed",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    }));
    return jsonResponse({ error: publicError(error) }, 502);
  }
}
