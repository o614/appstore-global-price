import { getApplePageUrl, getRegionDefinition, regionalPrices } from "./apple-price-regions.mjs";

const SERVICE_PATHS = {
  "apple-one": "apple-one",
  "apple-arcade": "apple-arcade",
  "apple-fitness-plus": "apple-fitness-plus",
  "apple-tv-plus": "apple-tv",
  "apple-news-plus": "apple-news",
};

const CADENCE_PATTERNS = {
  monthly: /per\s+month|\/\s*month|\/\s*mo\.?|monthly|month|(?:por|al)\s+mes|mensual|月額|每月|月費|\/月|ayda|aylık|tháng|매월|\/월|เดือน|monat|mois|mês|mensal|bulan/giu,
  annual: /per\s+year|annually|annual|year|年間|年額|每年|年費|yıllık|senelik|năm|연간|\/년|ปี|jahr|jährlich|annuel|par\s+an|al\s+año|ano|anual|tahun/giu,
};

function decodeHtml(text) {
  const named = { amp: "&", apos: "'", euro: "€", gt: ">", lt: "<", nbsp: " ", pound: "£", quot: '"', yen: "¥", uuml: "ü" };
  return text
    .replace(/&#x([\da-f]+);/giu, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/gu, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&([a-z]+);/giu, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function plainText(html) {
  return decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]+>/gu, " "))
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
}

function nearestCadenceDistance(text, candidate, cadence) {
  const start = Math.max(0, candidate.index - 90);
  const end = Math.min(text.length, candidate.end + 90);
  const context = text.slice(start, end);
  const priceStart = candidate.index - start;
  let distance = Infinity;
  for (const match of context.matchAll(new RegExp(CADENCE_PATTERNS[cadence].source, CADENCE_PATTERNS[cadence].flags))) {
    const keywordCenter = match.index + match[0].length / 2;
    const priceCenter = priceStart + (candidate.end - candidate.index) / 2;
    distance = Math.min(distance, Math.abs(keywordCenter - priceCenter));
  }
  return distance;
}

function selectCadencePrice(text, region, cadence, service) {
  const candidates = regionalPrices(text, region);
  const directMatches = [];
  const keywords = [...text.matchAll(new RegExp(CADENCE_PATTERNS[cadence].source, CADENCE_PATTERNS[cadence].flags))];
  for (const candidate of candidates) {
    for (const keyword of keywords) {
      const keywordEnd = keyword.index + keyword[0].length;
      const keywordFollows = keyword.index >= candidate.end;
      const distance = keywordFollows
        ? keyword.index - candidate.end
        : candidate.index >= keywordEnd
          ? candidate.index - keywordEnd
          : Infinity;
      const bridgeStart = Math.min(candidate.end, keywordEnd);
      const bridgeEnd = Math.max(candidate.index, keyword.index);
      const bridge = text.slice(bridgeStart, bridgeEnd);
      const crossesAlternative = /\b(?:or|ou|oder|atau|veya)\b|或|或者/iu.test(bridge);
      if (distance <= 48) directMatches.push({ candidate, crossesAlternative, distance });
    }
  }
  directMatches.sort((left, right) => Number(left.crossesAlternative) - Number(right.crossesAlternative)
    || left.distance - right.distance
    || left.candidate.index - right.candidate.index);
  if (directMatches[0]) return directMatches[0].candidate.price;
  if (cadence === "annual" && ["cn", "jp", "hk", "tw", "tr"].includes(region)) {
    const following = [];
    for (const keyword of text.matchAll(new RegExp(CADENCE_PATTERNS.annual.source, CADENCE_PATTERNS.annual.flags))) {
      const candidate = candidates.find((value) => value.index >= keyword.index + keyword[0].length && value.index - keyword.index < 45);
      if (candidate) following.push({ candidate, distance: candidate.index - keyword.index });
    }
    following.sort((left, right) => left.distance - right.distance);
    if (following[0]) return following[0].candidate.price;
  }
  const grouped = new Map();
  for (const candidate of candidates) {
    const distance = nearestCadenceDistance(text, candidate, cadence);
    if (!Number.isFinite(distance)) continue;
    const context = text.slice(Math.max(0, candidate.index - 130), Math.min(text.length, candidate.end + 130));
    let score = 320 - Math.min(distance, 180) * 3;
    if (context.toLowerCase().includes(service.toLowerCase().replaceAll("-plus", "+").replaceAll("-", " "))) score += 30;
    if (service === "apple-tv-plus" && /free (?:7|seven)[-\s]?day|new subscriber|7日|7 天|7 gün/iu.test(context)) score += 80;
    if (service === "apple-news-plus" && /free 1[-\s]?month|new subscriber|trial/iu.test(context)) score += 60;
    const current = grouped.get(candidate.price) ?? { ...candidate, score: -Infinity, count: 0 };
    current.score = Math.max(current.score, score);
    current.count += 1;
    grouped.set(candidate.price, current);
  }
  return [...grouped.values()]
    .map((candidate) => ({ ...candidate, score: candidate.score + Math.min(candidate.count, 8) }))
    .sort((left, right) => right.score - left.score)[0]?.price ?? null;
}

function extractAppleOnePlans(html, region) {
  return [
    { id: "individual", name: "Apple One Individual" },
    { id: "family", name: "Apple One Family" },
    { id: "premier", name: "Apple One Premier" },
  ].flatMap((plan) => {
    const card = html.match(new RegExp(`<p\\b[^>]*class=(?:"[^"]*\\bplan-${plan.id}\\b[^"]*"|'[^']*\\bplan-${plan.id}\\b[^']*')[^>]*>([\\s\\S]*?)<\\/p>`, "iu"));
    const price = card ? regionalPrices(plainText(card[1]), region)[0]?.price : null;
    return price ? [{ name: plan.name, price }] : [];
  });
}

function extractICloudPlusPlans(html, region) {
  const text = plainText(html);
  const country = getRegionDefinition(region).icloudCountry;
  if (!country) return [];
  const sizes = ["50 GB", "200 GB", "2 TB", "6 TB", "12 TB"];
  let cursor = text.indexOf(country);
  while (cursor >= 0) {
    const section = text.slice(cursor, cursor + 720);
    const prices = regionalPrices(section, region);
    const plans = sizes.flatMap((size, index) => {
      const sizeIndex = section.indexOf(size);
      const nextSizeIndex = index + 1 < sizes.length ? section.indexOf(sizes[index + 1], sizeIndex + size.length) : section.length;
      const price = prices.find((candidate) => candidate.index > sizeIndex && candidate.index < nextSizeIndex);
      return sizeIndex >= 0 && price ? [{ name: `iCloud+ ${size}`, price: price.price }] : [];
    });
    if (plans.length === sizes.length) return plans;
    cursor = text.indexOf(country, cursor + country.length);
  }
  return [];
}

export function getAppleServicePageUrl(region, service) {
  getRegionDefinition(region);
  if (service === "icloud-plus") return "https://support.apple.com/en-us/108047";
  if (region === "tr" && service === "apple-tv-plus") return "https://www.apple.com/tr/tv-home/";
  const path = SERVICE_PATHS[service];
  if (!path) throw new Error(`Unsupported Apple service: ${service}`);
  return getApplePageUrl(region, path);
}

export function extractAppleServicePlans(html, region, service) {
  if (service === "icloud-plus") return extractICloudPlusPlans(html, region);
  if (service === "apple-one") return extractAppleOnePlans(html, region);
  const text = plainText(html);
  const monthly = selectCadencePrice(text, region, "monthly", service);
  const annual = ["apple-arcade", "apple-fitness-plus"].includes(service)
    ? selectCadencePrice(text, region, "annual", service)
    : null;
  const labels = {
    "apple-arcade": "Apple Arcade",
    "apple-fitness-plus": "Apple Fitness+",
    "apple-tv-plus": "Apple TV+",
    "apple-news-plus": "Apple News+",
  };
  const label = labels[service];
  return [
    monthly ? { name: `${label} Monthly`, price: monthly } : null,
    annual && annual !== monthly ? { name: `${label} Annual`, price: annual } : null,
  ].filter(Boolean);
}
