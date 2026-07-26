import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const snapshotPath = resolve(option("--snapshot", "data/validation-snapshot.json"));
const configPath = resolve(option("--config", "data/catalog-config.json"));
const regionsPath = resolve(option("--regions", "data/regions.json"));
const previousOption = option("--previous");
const previousPath = previousOption ? resolve(previousOption) : null;
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const regionData = JSON.parse(await readFile(regionsPath, "utf8"));
const expectedRegions = regionData.regions?.map((region) => region.code) ?? [];
const previous = previousPath ? JSON.parse(await readFile(previousPath, "utf8")) : null;
const errors = [];

function populatedCount(value) {
  return value.apps.flatMap((app) => app.regions ?? []).filter((region) => region.itemCount > 0).length;
}

if (!snapshot.generatedAt || Number.isNaN(Date.parse(snapshot.generatedAt))) errors.push("generatedAt is invalid");
if (snapshot.source !== "Apple public App Store product and service pricing pages") errors.push("source is unexpected");

const expectedIds = config.apps.map((app) => app.id);
const actualIds = snapshot.apps?.map((app) => app.id) ?? [];
if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
  errors.push(`App IDs do not match configuration: expected ${expectedIds.join(", ")}`);
}
if (expectedRegions.length !== 20) errors.push(`Expected exactly 20 fixed regions, received ${expectedRegions.length}`);
if (new Set(expectedRegions).size !== expectedRegions.length) errors.push("Region codes are not unique");
if (JSON.stringify(expectedRegions) !== JSON.stringify(snapshot.regions)) errors.push("Top-level regions do not match configuration");

for (const entry of config.apps) {
  const app = snapshot.apps?.find((candidate) => candidate.id === entry.id);
  if (!app) continue;
  if (!app.matchedName || !app.developer || (app.priceSource !== "apple-service" && !app.icon)) errors.push(`${entry.id} metadata is incomplete`);
  if (app.priceSource !== (entry.priceSource ?? "app-store")) errors.push(`${app.matchedName} priceSource does not match configuration`);
  const regionCodes = app.regions?.map((region) => region.region) ?? [];
  if (JSON.stringify(expectedRegions) !== JSON.stringify(regionCodes)) errors.push(`${app.matchedName} regions do not match configuration`);

  for (const region of app.regions ?? []) {
    const allowedEmpty = region.status === "iap-section-missing" || region.status === "official-price-page-missing" || region.status === "error:HTTP 404";
    const allowedPopulated = typeof region.status === "string" && region.status.startsWith("ok-");
    if (!allowedEmpty && !allowedPopulated) errors.push(`${app.matchedName}/${region.region} has unsafe status: ${region.status}`);
    if (!Array.isArray(region.items) || region.itemCount !== region.items?.length) {
      errors.push(`${app.matchedName}/${region.region} itemCount does not match items`);
      continue;
    }
    if (allowedPopulated && region.items.length === 0) errors.push(`${app.matchedName}/${region.region} reports ok with no items`);
    if (allowedEmpty && region.items.length > 0) errors.push(`${app.matchedName}/${region.region} reports empty status with items`);
    const keys = new Set();
    for (const item of region.items) {
      if (!item.name?.trim() || !item.price?.trim()) errors.push(`${app.matchedName}/${region.region} contains an empty item`);
      else if (!/\d/u.test(item.price)) errors.push(`${app.matchedName}/${region.region} contains an invalid price: ${item.price}`);
      const key = `${item.name}\u0000${item.price}`;
      if (keys.has(key)) errors.push(`${app.matchedName}/${region.region} contains a duplicate item: ${item.name}`);
      keys.add(key);
    }
  }

  if (previous && !entry.allowAllEmpty) {
    const oldApp = previous.apps?.find((candidate) => candidate.id === entry.id);
    const oldPopulated = oldApp?.regions?.filter((region) => region.itemCount > 0).length ?? 0;
    const newPopulated = app.regions?.filter((region) => region.itemCount > 0).length ?? 0;
    if (oldPopulated >= 5 && newPopulated === 0) errors.push(`${app.matchedName} unexpectedly lost all populated regions`);
  }
}

if (previous) {
  const oldPopulated = populatedCount(previous);
  const newPopulated = populatedCount(snapshot);
  if (oldPopulated >= 20 && newPopulated < Math.floor(oldPopulated * 0.6)) {
    errors.push(`Populated region pages dropped suspiciously from ${oldPopulated} to ${newPopulated}`);
  }
}

if (errors.length) {
  console.error("Snapshot validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Snapshot is valid: ${snapshot.apps.length} apps, ${snapshot.regions.length} regions, ${populatedCount(snapshot)} populated pages.`);
}
