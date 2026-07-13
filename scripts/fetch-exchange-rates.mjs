import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputFlagIndex = process.argv.indexOf("--output");
const outputPath = resolve(
  outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]
    ? process.argv[outputFlagIndex + 1]
    : "data/exchange-rates.json",
);

const response = await fetch("https://open.er-api.com/v6/latest/CNY", {
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) throw new Error(`Exchange rate request failed: HTTP ${response.status}`);
const payload = await response.json();
if (payload.result !== "success" || !payload.rates) {
  throw new Error("Exchange rate response is invalid");
}

const currencies = ["CNY", "USD", "JPY", "HKD", "TWD", "TRY", "PHP", "PKR", "CAD", "SGD"];
const rates = Object.fromEntries(currencies.map((currency) => [currency, payload.rates[currency]]));

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
