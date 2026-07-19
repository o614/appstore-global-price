import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const expectedCodes = [
  "cn", "us", "hk", "tw", "vn", "sg", "jp", "kr", "th", "gb",
  "de", "fr", "ca", "tr", "au", "ph", "ng", "in", "br", "id",
];

test("uses the agreed fixed set of 20 regions everywhere", async () => {
  const [regionData, snapshot, rates] = await Promise.all([
    readFile(new URL("../data/regions.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/exchange-rates.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const codes = regionData.regions.map((region) => region.code);
  assert.deepEqual(codes, expectedCodes);
  assert.equal(new Set(codes).size, 20);
  assert.ok(regionData.regions.every((region) => region.name && region.currency && region.storefrontId && region.appleHost));
  await Promise.all(expectedCodes.map((code) => access(new URL(`../public/flags/${code}.png`, import.meta.url))));
  assert.deepEqual(snapshot.regions, expectedCodes);
  for (const app of snapshot.apps) assert.deepEqual(app.regions.map((region) => region.region), expectedCodes);
  for (const currency of new Set(regionData.regions.map((region) => region.currency))) {
    assert.ok(Number.isFinite(rates.rates[currency]), `${currency} exchange rate is missing`);
  }
});
