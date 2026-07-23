import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const diffPath = resolve(option("--diff", ".tmp/price-diff.json"));
const logPath = resolve(option("--log", "data/price-change-log.json"));
const publishedAt = option("--published-at", new Date().toISOString());
const limit = Number(option("--limit", "120"));

if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("--limit must be an integer between 1 and 500");
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

const entry = {
  id: diff.fingerprint,
  publishedAt,
  checkedAt: diff.checkedAt,
  changeCount: diff.changeCount,
  changes: diff.changes,
};

log.entries = [entry, ...log.entries].slice(0, limit);
await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
console.log(`Recorded ${diff.changeCount} published app/region changes (${diff.fingerprint}).`);
