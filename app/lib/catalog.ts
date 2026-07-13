import snapshot from "../../data/validation-snapshot.json";
import exchangeRates from "../../data/exchange-rates.json";

export type IapItem = { name: string; price: string };
export type RegionSnapshot = {
  region: string;
  status: string;
  itemCount: number;
  sample: IapItem[];
};

export type AppSnapshot = {
  query: string;
  id: string;
  matchedName: string;
  developer: string;
  icon?: string;
  category?: string;
  storeUrl?: string;
  regions: RegionSnapshot[];
};

export type PlanDefinition = {
  id: string;
  label: string;
  period: string;
  aliases: string[];
  occurrence?: number;
};

export const apps = snapshot as AppSnapshot[];

export const regionMeta: Record<string, { name: string; flag: string; currency: string }> = {
  cn: { name: "中国", flag: "🇨🇳", currency: "CNY" },
  us: { name: "美国", flag: "🇺🇸", currency: "USD" },
  jp: { name: "日本", flag: "🇯🇵", currency: "JPY" },
  hk: { name: "香港", flag: "🇭🇰", currency: "HKD" },
  tw: { name: "台湾", flag: "🇹🇼", currency: "TWD" },
  tr: { name: "土耳其", flag: "🇹🇷", currency: "TRY" },
  ph: { name: "菲律宾", flag: "🇵🇭", currency: "PHP" },
  pk: { name: "巴基斯坦", flag: "🇵🇰", currency: "PKR" },
  ca: { name: "加拿大", flag: "🇨🇦", currency: "CAD" },
  sg: { name: "新加坡", flag: "🇸🇬", currency: "SGD" },
};

export const planDefinitions: Record<string, PlanDefinition[]> = {
  "6448311069": [
    { id: "plus-monthly", label: "ChatGPT Plus", period: "月付", aliases: ["ChatGPT Plus"] },
    { id: "go-monthly", label: "ChatGPT Go", period: "月付", aliases: ["ChatGPT Go"] },
    { id: "pro-5x", label: "ChatGPT Pro 5x", period: "月付", aliases: ["ChatGPT Pro 5x"] },
    { id: "pro-20x", label: "ChatGPT Pro 20x", period: "月付", aliases: ["ChatGPT Pro 20x"] },
  ],
  "6473753684": [
    { id: "pro-monthly", label: "Claude Pro", period: "月付", aliases: ["Claude Pro - Monthly"] },
    { id: "max-5x", label: "Claude Max 5x", period: "月付", aliases: ["Claude Max 5x - Monthly"] },
    { id: "max-20x", label: "Claude Max 20x", period: "月付", aliases: ["Claude Max 20x - Monthly"] },
    { id: "pro-annual", label: "Claude Pro", period: "年付", aliases: ["Claude Pro - Annual"] },
  ],
  "6477489729": [
    { id: "ai-pro", label: "Google AI Pro", period: "月付", aliases: ["Google AI Pro (5 TB)"] },
    { id: "ai-plus", label: "Google AI Plus", period: "月付", aliases: ["Google AI Plus (400 GB)", "Google AI Plus (200GB)", "Google AI Plus (2 TB)"] },
    { id: "ai-ultra", label: "Google AI Ultra", period: "月付", aliases: ["Google AI Ultra (30 TB)"] },
  ],
  "6670324846": [
    { id: "supergrok", label: "SuperGrok", period: "月付", aliases: ["SuperGrok"] },
    { id: "supergrok-lite", label: "SuperGrok Lite", period: "月付", aliases: ["SuperGrok Lite"] },
    { id: "supergrok-heavy", label: "SuperGrok Heavy", period: "月付", aliases: ["SuperGrok Heavy"] },
  ],
  "686449807": [
    { id: "premium", label: "Telegram Premium", period: "公开套餐", aliases: ["Telegram Premium"] },
    { id: "stars-100", label: "Telegram Stars 100", period: "一次性", aliases: ["100 Telegram Stars"] },
    { id: "stars-500", label: "Telegram Stars 500", period: "一次性", aliases: ["500 Telegram Stars"] },
  ],
  "544007664": [
    { id: "premium", label: "YouTube Premium", period: "公开套餐", aliases: ["YouTube Premium"] },
    { id: "family", label: "YouTube Premium Family", period: "公开套餐", aliases: ["YouTube Premium Family", "Youtube Premium Family"] },
  ],
  "333903271": [
    { id: "premium-monthly", label: "X Premium", period: "月付", aliases: ["X Premium (Monthly)"] },
    { id: "basic-monthly", label: "X Premium Basic", period: "月付", aliases: ["X Premium Basic (Monthly)"] },
    { id: "plus-monthly", label: "X Premium Plus", period: "月付", aliases: ["X Premium Plus (Monthly)"] },
    { id: "premium-annual", label: "X Premium", period: "年付", aliases: ["X Premium (Annual)"] },
  ],
  "1451784328": [
    { id: "100gb-monthly", label: "Google One 100 GB", period: "月付", aliases: ["100 GB", "100 GB Month"] },
    { id: "200gb-monthly", label: "Google One 200 GB", period: "月付", aliases: ["200 GB", "200 GB Month"] },
    { id: "ai-plus-2tb", label: "Google AI Plus 2 TB", period: "月付", aliases: ["Google AI Plus (2 TB)"] },
  ],
  "547166701": [
    { id: "svip-auto", label: "百度网盘超级会员", period: "自动续费月付", aliases: ["百度网盘自动续费超级会员（1个月）", "百度网盘超级会员(1个月-自动续费)"] },
    { id: "svip-first", label: "百度网盘超级会员首充", period: "月付", aliases: ["百度网盘超级会员(1个月-自动续费)(首充)"] },
  ],
};

export const dataUpdatedAt = "2026-07-13";
export const rateUpdatedAt = exchangeRates.updatedAt;
export const rateProvider = exchangeRates.provider;
export const rateAttributionUrl = exchangeRates.attributionUrl;

function parseAmount(text: string, currency: string) {
  let numeric = text.replace(/[^\d.,]/g, "");
  if (!numeric) return null;
  if (currency === "TRY") numeric = numeric.replace(/\./g, "").replace(",", ".");
  else numeric = numeric.replace(/,/g, "");
  const amount = Number(numeric);
  return Number.isFinite(amount) ? amount : null;
}

export function findPlanItem(region: RegionSnapshot, plan: PlanDefinition) {
  const matches = region.sample.filter((item) => plan.aliases.includes(item.name));
  return matches[plan.occurrence ?? 0] ?? null;
}

export function toCny(price: string, regionCode: string) {
  const currency = regionMeta[regionCode]?.currency;
  if (!currency) return null;
  const amount = parseAmount(price, currency);
  const rate = (exchangeRates.rates as Record<string, number>)[currency];
  if (amount === null || !rate) return null;
  return amount / rate;
}

export function getApp(id: string) {
  return apps.find((app) => app.id === id);
}

export function getVerifiedRegionCount(app: AppSnapshot) {
  return app.regions.filter((region) => region.status.startsWith("ok-") && region.itemCount > 0).length;
}
