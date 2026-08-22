import { readFile } from "node:fs/promises";

const regionData = JSON.parse(await readFile(new URL("../data/regions.json", import.meta.url), "utf8"));

export const regionDefinitions = regionData.regions;

const regionsByCode = new Map(regionDefinitions.map((region) => [region.code, region]));

const CURRENCY_FORMATS = {
  CNY: { prefix: "RMB ", patterns: [/(?:RMB|¥|￥)\s*([\d.,]+)/giu] },
  USD: { prefix: "$", patterns: [/\$\s*([\d.,]+)/gu] },
  HKD: { prefix: "HK$", patterns: [/HK\$\s*([\d.,]+)/giu] },
  TWD: { prefix: "NT$", patterns: [/NT\$\s*([\d.,]+)/giu] },
  VND: { prefix: "₫", patterns: [/₫\s*([\d.,]+)/gu, /([\d.,]+)\s*(?:₫|đ)/giu] },
  SGD: { prefix: "S$", patterns: [/S\$\s*([\d.,]+)/giu] },
  JPY: { prefix: "¥", patterns: [/¥\s*([\d.,]+)/gu, /([\d.,]+)\s*円/gu] },
  KRW: { prefix: "₩", patterns: [/₩\s*([\d.,]+)/gu, /([\d.,]+)\s*원/gu] },
  THB: { prefix: "฿", patterns: [/฿\s*([\d.,]+)/gu] },
  GBP: { prefix: "£", patterns: [/£\s*([\d.,]+)/gu] },
  EUR: { prefix: "€", patterns: [/€\s*([\d.,]+)/gu, /([\d.,]+)\s*€/gu] },
  CAD: { prefix: "$", patterns: [/(?:CA)?\$\s*([\d.,]+)/giu] },
  TRY: { prefix: "₺", patterns: [/₺\s*([\d.,]+)/gu, /([\d.,]+)\s*TL/giu] },
  AUD: { prefix: "$", patterns: [/(?:A)?\$\s*([\d.,]+)/giu] },
  PHP: { prefix: "₱", patterns: [/₱\s*([\d.,]+)/gu] },
  NGN: { prefix: "₦", patterns: [/₦\s*([\d.,]+)/gu] },
  INR: { prefix: "₹", patterns: [/₹\s*([\d.,]+)/gu, /\bRs\.?\s*([\d.,]+)/giu] },
  BRL: { prefix: "R$", patterns: [/R\$\s*([\d.,]+)/giu] },
  IDR: { prefix: "Rp", patterns: [/Rp\s*([\d.,]+)/giu] },
  MXN: { prefix: "$", patterns: [/(?:MX)?\$\s*([\d.,]+)/giu] },
  NZD: { prefix: "$", patterns: [/(?:NZ)?\$\s*([\d.,]+)/giu] },
  AED: { prefix: "AED ", patterns: [/(?:AED|د\.?إ\.?)\s*([\d.,]+)/giu] },
  SAR: {
    prefix: "SAR ",
    patterns: [/(?:SAR|ر\.?س\.?)\s*([\d.,]+)/giu, /([\d.,]+)\s*﷼/gu],
  },
};

export function getRegionDefinition(regionCode) {
  const region = regionsByCode.get(regionCode);
  if (!region) throw new Error(`Unsupported Apple price region: ${regionCode}`);
  return region;
}

export function getApplePageUrl(regionCode, path) {
  return `${getRegionDefinition(regionCode).appleHost}/${path}/`;
}

export function regionalPrices(text, regionCode) {
  const region = getRegionDefinition(regionCode);
  const format = CURRENCY_FORMATS[region.currency];
  if (!format) throw new Error(`Unsupported Apple price currency: ${region.currency}`);
  const matches = [];
  for (const template of format.patterns) {
    const expression = new RegExp(template.source, template.flags);
    for (const match of text.matchAll(expression)) {
      const amountText = match[1].replace(/[.,]+$/u, "");
      if (!/\d/u.test(amountText)) continue;
      matches.push({
        index: match.index,
        end: match.index + match[0].length - (match[1].length - amountText.length),
        amountText,
        price: `${format.prefix}${amountText}`,
      });
    }
  }
  return matches
    .sort((left, right) => left.index - right.index)
    .filter((match, index, values) => !values.slice(0, index).some((value) => value.index === match.index && value.price === match.price));
}

export function numericAmount(value, regionCode) {
  const currency = getRegionDefinition(regionCode).currency;
  let numeric = value.replace(/[^\d.,]/gu, "");
  if (!numeric) return NaN;
  const comma = numeric.lastIndexOf(",");
  const dot = numeric.lastIndexOf(".");
  const decimalCommaCurrencies = new Set(["EUR", "TRY", "BRL"]);
  const zeroDecimalCurrencies = new Set(["VND", "JPY", "KRW", "IDR"]);
  if (zeroDecimalCurrencies.has(currency)) numeric = numeric.replace(/[.,]/gu, "");
  else if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    numeric = numeric.replace(decimal === "," ? /\./gu : /,/gu, "").replace(decimal, ".");
  } else if (comma >= 0) {
    numeric = decimalCommaCurrencies.has(currency) || numeric.length - comma - 1 === 2
      ? numeric.replace(/\./gu, "").replace(",", ".")
      : numeric.replace(/,/gu, "");
  } else if (dot >= 0 && numeric.length - dot - 1 !== 2) numeric = numeric.replace(/\./gu, "");
  return Number(numeric);
}
