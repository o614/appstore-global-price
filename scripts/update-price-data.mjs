import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectory = resolve(root, ".tmp", `price-update-${process.pid}-${Date.now()}`);
const candidateSnapshot = resolve(temporaryDirectory, "validation-snapshot.json");
const candidateRates = resolve(temporaryDirectory, "exchange-rates.json");
const candidateDiff = resolve(temporaryDirectory, "price-diff.json");
const candidateDiffMarkdown = resolve(temporaryDirectory, "price-diff.md");
const candidateLog = resolve(temporaryDirectory, "price-change-log.json");
const publishedSnapshot = resolve(root, "data", "validation-snapshot.json");
const publishedRates = resolve(root, "data", "exchange-rates.json");
const publishedLog = resolve(root, "data", "price-change-log.json");
const reuseCurrent = process.argv.includes("--reuse-current");
const appBatchSizeIndex = process.argv.indexOf("--app-batch-size");
const appBatchSize = appBatchSizeIndex === -1 ? null : process.argv[appBatchSizeIndex + 1];

function run(script, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(root, script), ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${script} exited with code ${code ?? "unknown"}`));
    });
  });
}

await mkdir(temporaryDirectory, { recursive: true });

try {
  console.log("1/5 Fetching a candidate Apple price snapshot…");
  const fetchArgs = ["--output", candidateSnapshot];
  if (reuseCurrent) fetchArgs.push("--reuse", publishedSnapshot);
  if (appBatchSize) fetchArgs.push("--app-batch-size", appBatchSize);
  await run("scripts/fetch-price-snapshot.mjs", fetchArgs);

  console.log("2/5 Validating the candidate against the current published snapshot…");
  await run("scripts/validate-price-snapshot.mjs", [
    "--snapshot", candidateSnapshot,
    "--previous", publishedSnapshot,
  ]);

  console.log("3/5 Comparing the candidate with the published snapshot…");
  await run("scripts/compare-price-snapshots.mjs", [
    "--before", publishedSnapshot,
    "--after", candidateSnapshot,
    "--json", candidateDiff,
    "--markdown", candidateDiffMarkdown,
  ]);

  console.log("4/5 Preparing the public price change log…");
  await copyFile(publishedLog, candidateLog);
  await run("scripts/update-price-change-log.mjs", [
    "--diff", candidateDiff,
    "--log", candidateLog,
  ]);

  console.log("5/5 Fetching the exchange rates required by the fixed region list…");
  await run("scripts/fetch-exchange-rates.mjs", ["--output", candidateRates]);

  const [previousSnapshot, previousRates, previousLog] = await Promise.all([
    readFile(publishedSnapshot),
    readFile(publishedRates),
    readFile(publishedLog),
  ]);

  try {
    await copyFile(candidateSnapshot, publishedSnapshot);
    await copyFile(candidateRates, publishedRates);
    await copyFile(candidateLog, publishedLog);
  } catch (error) {
    await Promise.all([
      writeFile(publishedSnapshot, previousSnapshot),
      writeFile(publishedRates, previousRates),
      writeFile(publishedLog, previousLog),
    ]);
    throw error;
  }

  console.log("Price snapshot, exchange rates, and public change log were published together successfully.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
