import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputFlagIndex = process.argv.indexOf("--output");
const outputPath = resolve(
  outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]
    ? process.argv[outputFlagIndex + 1]
    : "data/exchange-rates.json",
);
const regionsFlagIndex = process.argv.indexOf("--regions");
const regionsPath = resolve(
  regionsFlagIndex !== -1 && process.argv[regionsFlagIndex + 1]
    ? process.argv[regionsFlagIndex + 1]
    : "data/regions.json",
);

const response = await fetch("https://open.er-api.com/v6/latest/CNY", {
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) throw new Error(`Exchange rate request failed: HTTP ${response.status}`);
const payload = await response.json();
if (payload.result !== "success" || !payload.rates) {
  throw new Error("Exchange rate response is invalid");
}

const regionData = JSON.parse(await readFile(regionsPath, "utf8"));
const currencies = [...new Set(regionData.regions.map((region) => region.currency))];
const rates = Object.fromEntries(currencies.map((currency) => [currency, payload.rates[currency]]));
const missingCurrencies = currencies.filter((currency) => !Number.isFinite(rates[currency]));
if (missingCurrencies.length) throw new Error(`Exchange rate response is missing: ${missingCurrencies.join(", ")}`);

const snapshot = {
  provider: "ExchangeRate-API",
  attributionUrl: "https://www.exchangerate-api.com",
  base: "CNY",
  updatedAt: payload.time_last_update_utc,
  rates,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Saved exchange rates to ${outputPath}`);
