import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const firstPath = resolve(option("--first", ".tmp/price-diff-first.json"));
const secondPath = resolve(option("--second", ".tmp/price-diff-confirmed.json"));
const githubOutput = option("--github-output");
const [first, second] = await Promise.all([
  readFile(firstPath, "utf8").then(JSON.parse),
  readFile(secondPath, "utf8").then(JSON.parse),
]);

const confirmed = first.changed === true
  && second.changed === true
  && first.fingerprint !== "none"
  && first.fingerprint === second.fingerprint;

if (githubOutput) {
  await appendFile(
    githubOutput,
    `confirmed=${confirmed}\nfingerprint=${second.fingerprint ?? "none"}\n`,
    "utf8",
  );
}

if (!confirmed) {
  console.warn(JSON.stringify({
    event: "price-change-confirmation-failed",
    firstFingerprint: first.fingerprint ?? "missing",
    secondFingerprint: second.fingerprint ?? "missing",
    firstChanged: first.changed === true,
    secondChanged: second.changed === true,
  }));
  console.log("Two snapshots did not confirm the same change; keeping the published data.");
  process.exit(0);
}

console.log(`Confirmed price change ${second.fingerprint} with two independent snapshots.`);
