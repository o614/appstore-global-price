import snapshot from "../../data/validation-snapshot.json";
import exchangeRates from "../../data/exchange-rates.json";
import planDefinitionData from "../../data/plan-definitions.json";
import regionDefinitionData from "../../data/regions.json";
import { discoverPlans } from "./plan-discovery.mjs";
import { convertToBaseCurrency } from "./price-conversion.mjs";

export type IapItem = { name: string; price: string };
export type RegionSnapshot = {
  region: string;
  status: string;
  itemCount: number;
  items: IapItem[];
};

export type AppSnapshot = {
  query: string;
  id: string;
  matchedName: string;
  developer: string;
  icon?: string;
  category?: string;
  group?: string;
  regionalAppIds?: Record<string, string>;
  storeUrl?: string;
  priceSource?: "app-store" | "apple-music" | "apple-service";
  service?: string;
  regions: RegionSnapshot[];
};

export type PlanDefinition = {
  id: string;
  label: string;
  period: string;
  aliases: string[];
  occurrence?: number;
};

export type RegionEvidenceState = "verified" | "unavailable" | "not-public" | "review";

export type CoverageSummary = {
  verified: number;
  unavailable: number;
  notPublic: number;
  review: number;
  total: number;
};

type ValidationSnapshot = {
  generatedAt: string;
  source: string;
  regions: string[];
  apps: AppSnapshot[];
};

type RegionDefinition = {
  code: string;
  name: string;
  currency: string;
  storefrontId: number;
  appleHost: string;
  icloudCountry: string;
};

const validationSnapshot = snapshot as ValidationSnapshot;
export const apps = validationSnapshot.apps;

const regionDefinitions = regionDefinitionData.regions as RegionDefinition[];
const regionDefinitionsByCode = new Map(regionDefinitions.map((region) => [region.code, region]));

export const regionMeta = Object.fromEntries(
  regionDefinitions.map(({ code, name, currency }) => [code, { name, currency, flagPath: `/flags/${code}.png` }]),
) as Record<string, { name: string; currency: string; flagPath: string }>;

const regionStorefrontIds = Object.fromEntries(
  regionDefinitions.map(({ code, storefrontId }) => [code, storefrontId]),
) as Record<string, number>;

export const planDefinitions = planDefinitionData as Record<string, PlanDefinition[]>;

export function getPlansForApp(app: AppSnapshot) {
  return discoverPlans(app, planDefinitions[app.id] ?? []);
}

export const dataUpdatedAt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(validationSnapshot.generatedAt));
export const dataGeneratedAt = validationSnapshot.generatedAt;
export const dataSource = validationSnapshot.source;
export const dataSourceUrl = "https://www.apple.com";
export const rateUpdatedAt = exchangeRates.updatedAt;
export const rateProvider = exchangeRates.provider;
export const rateAttributionUrl = exchangeRates.attributionUrl;

export function findPlanItem(region: RegionSnapshot, plan: PlanDefinition) {
  const matches = region.items.filter((item) => plan.aliases.includes(item.name));
  return matches[plan.occurrence ?? 0] ?? null;
}

export function toCny(price: string, regionCode: string) {
  const currency = regionMeta[regionCode]?.currency;
  if (!currency) return null;
  const rate = (exchangeRates.rates as Record<string, number>)[currency];
  return convertToBaseCurrency(price, currency, rate);
}

export function getApp(id: string) {
  return apps.find((app) => app.id === id);
}

export function getRegionEvidenceState(region: RegionSnapshot): RegionEvidenceState {
  if (region.status.startsWith("ok-") && region.itemCount > 0) return "verified";
  if (region.status === "service-unavailable" || region.status === "error:HTTP 404") return "unavailable";
  if (
    region.status === "official-price-unpublished"
    || region.status === "iap-section-missing"
    || region.status === "official-price-page-missing"
    || (region.status.startsWith("ok-") && region.itemCount === 0)
  ) {
    return "not-public";
  }
  return "review";
}

export function getAppCoverage(app: AppSnapshot): CoverageSummary {
  return app.regions.reduce<CoverageSummary>(
    (coverage, region) => {
      const state = getRegionEvidenceState(region);
      if (state === "not-public") coverage.notPublic += 1;
      else coverage[state] += 1;
      coverage.total += 1;
      return coverage;
    },
    { verified: 0, unavailable: 0, notPublic: 0, review: 0, total: 0 },
  );
}

export function getCatalogCoverage(): CoverageSummary {
  return apps.reduce<CoverageSummary>(
    (total, app) => {
      const coverage = getAppCoverage(app);
      total.verified += coverage.verified;
      total.unavailable += coverage.unavailable;
      total.notPublic += coverage.notPublic;
      total.review += coverage.review;
      total.total += coverage.total;
      return total;
    },
    { verified: 0, unavailable: 0, notPublic: 0, review: 0, total: 0 },
  );
}

export function getVerifiedRegionCount(app: AppSnapshot) {
  return getAppCoverage(app).verified;
}

export function getPublicItemRange(app: AppSnapshot) {
  const counts = app.regions
    .filter((region) => region.status.startsWith("ok-") && region.itemCount > 0)
    .map((region) => region.itemCount);
  if (!counts.length) return { min: 0, max: 0 };
  return { min: Math.min(...counts), max: Math.max(...counts) };
}

export function getRegionStoreUrl(appId: string, regionCode: string, regionalAppIds?: Record<string, string>) {
  const resolvedAppId = regionalAppIds?.[regionCode] ?? appId;
  return `https://apps.apple.com/${regionCode}/app/id${resolvedAppId}`;
}

export function getRegionPriceSourceUrl(app: AppSnapshot, regionCode: string) {
  if (app.priceSource === "app-store" || !app.priceSource) return getRegionStoreUrl(app.id, regionCode, app.regionalAppIds);
  const region = regionDefinitionsByCode.get(regionCode);
  if (!region) return null;
  if (app.priceSource === "apple-music") {
    return `${region.appleHost}/apple-music/`;
  }
  if (app.service === "icloud-plus") return "https://support.apple.com/en-us/108047";
  if (regionCode === "tr" && app.service === "apple-tv-plus") return "https://www.apple.com/tr/tv-home/";
  const path = app.service === "apple-tv-plus"
    ? "apple-tv"
    : app.service === "apple-news-plus"
      ? "apple-news"
      : app.service;
  return path ? `${region.appleHost}/${path}/` : null;
}

export function getPriceSourceCopy(app: AppSnapshot) {
  if (app.priceSource === "apple-music") return { noun: "Apple Music 官方方案页", missing: "官方价格未公开", status: "无公开价格" };
  if (app.priceSource === "apple-service") return { noun: "Apple 官方服务价格页", missing: "官方价格未提供", status: "当地未提供" };
  return { noun: "Apple 商品页", missing: "未公开内购", status: "无公开内购" };
}

export function getRegionStoreAppUrl(appId: string, regionCode: string, regionalAppIds?: Record<string, string>) {
  const resolvedAppId = regionalAppIds?.[regionCode] ?? appId;
  return `itms-apps://apps.apple.com/${regionCode}/app/id${resolvedAppId}`;
}

export function getRegionSwitchUrl(regionCode: string) {
  const storefrontId = regionStorefrontIds[regionCode];
  if (!storefrontId) return null;
  return `itms-apps://itunes.apple.com/WebObjects/MZStore.woa/wa/resetAndRedirect?dsf=${storefrontId}&cc=${regionCode}`;
}
