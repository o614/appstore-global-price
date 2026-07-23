import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

function compactPriceItem(item, kind) {
  if (!item || typeof item.name !== "string") return null;
  if (kind === "updated") {
    if (typeof item.beforePrice !== "string" || typeof item.afterPrice !== "string") return null;
    return { name: item.name, beforePrice: item.beforePrice, afterPrice: item.afterPrice };
  }
  if (typeof item.price !== "string") return null;
  return { name: item.name, price: item.price };
}

function compactChange(change) {
  if (!change || typeof change.type !== "string" || typeof change.appId !== "string" || typeof change.appName !== "string") {
    return null;
  }

  const compact = {
    type: change.type,
    appId: change.appId,
    appName: change.appName,
  };
  if (typeof change.region === "string") compact.region = change.region;

  if (change.type === "region-items-changed") {
    if (typeof change.beforeState === "string") compact.beforeState = change.beforeState;
    if (typeof change.afterState === "string") compact.afterState = change.afterState;
    for (const key of ["updated", "added", "removed"]) {
      const items = Array.isArray(change[key])
        ? change[key].map((item) => compactPriceItem(item, key)).filter(Boolean)
        : [];
      if (items.length) compact[key] = items;
    }
  }

  return compact;
}

function compactEntry(entry) {
  const changes = Array.isArray(entry?.changes) ? entry.changes.map(compactChange).filter(Boolean) : [];
  if (typeof entry?.id !== "string" || typeof entry?.publishedAt !== "string" || changes.length === 0) return null;
  return {
    id: entry.id,
    publishedAt: entry.publishedAt,
    changeCount: changes.length,
    changes,
  };
}

const diffPath = resolve(option("--diff", ".tmp/price-diff.json"));
const logPath = resolve(option("--log", "data/price-change-log.json"));
const publishedAt = option("--published-at", new Date().toISOString());
const limit = Number(option("--limit", "30"));

if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit must be an integer between 1 and 100");
}
if (Number.isNaN(Date.parse(publishedAt))) throw new Error("--published-at must be a valid date");

const diff = JSON.parse(await readFile(diffPath, "utf8"));
const log = JSON.parse(await readFile(logPath, "utf8"));
if (log.version !== 1 || !Array.isArray(log.entries)) throw new Error("Price change log has an unsupported shape");
if (!diff.changed || !Array.isArray(diff.changes) || diff.changes.length === 0) {
  console.log("No published price changes to append.");
  process.exit(0);
}
if (!diff.fingerprint || diff.fingerprint === "none") throw new Error("Changed diff is missing a fingerprint");
if (log.entries.some((entry) => entry.id === diff.fingerprint)) {
  console.log(`Price change ${diff.fingerprint} is already recorded.`);
  process.exit(0);
}

const changes = diff.changes.map(compactChange).filter(Boolean);
if (changes.length === 0) throw new Error("Changed diff does not contain publishable price changes");
const entry = {
  id: diff.fingerprint,
  publishedAt,
  changeCount: changes.length,
  changes,
};

const previousEntries = log.entries.map(compactEntry).filter(Boolean);
log.entries = [entry, ...previousEntries].slice(0, limit);
await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
console.log(`Recorded ${changes.length} published app/region changes (${diff.fingerprint}).`);
