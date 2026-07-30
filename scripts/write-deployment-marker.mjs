import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const snapshotPath = resolve(option("--snapshot", "data/validation-snapshot.json"));
const ratesPath = resolve(option("--rates", "data/exchange-rates.json"));
const outputPath = resolve(option("--output", "public/deployment-status.json"));
const [snapshot, rates] = await Promise.all([
  readFile(snapshotPath, "utf8").then(JSON.parse),
  readFile(ratesPath, "utf8").then(JSON.parse),
]);

if (Number.isNaN(Date.parse(snapshot.generatedAt))) throw new Error("Snapshot generatedAt is invalid");
if (Number.isNaN(Date.parse(rates.updatedAt))) throw new Error("Exchange-rate updatedAt is invalid");

const identity = {
  snapshotGeneratedAt: snapshot.generatedAt,
  ratesUpdatedAt: rates.updatedAt,
};
const marker = {
  version: 1,
  id: createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20),
  ...identity,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
console.log(`Wrote deployment marker ${marker.id} to ${outputPath}`);
