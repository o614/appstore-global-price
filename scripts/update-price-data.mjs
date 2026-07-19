import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectory = resolve(root, ".tmp", `price-update-${process.pid}-${Date.now()}`);
const candidateSnapshot = resolve(temporaryDirectory, "validation-snapshot.json");
const candidateRates = resolve(temporaryDirectory, "exchange-rates.json");
const publishedSnapshot = resolve(root, "data", "validation-snapshot.json");
const publishedRates = resolve(root, "data", "exchange-rates.json");

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
  console.log("1/3 Fetching a candidate Apple price snapshot…");
  await run("scripts/fetch-price-snapshot.mjs", ["--output", candidateSnapshot]);

  console.log("2/3 Validating the candidate against the current published snapshot…");
  await run("scripts/validate-price-snapshot.mjs", [
    "--snapshot", candidateSnapshot,
    "--previous", publishedSnapshot,
  ]);

  console.log("3/3 Fetching the exchange rates required by the fixed region list…");
  await run("scripts/fetch-exchange-rates.mjs", ["--output", candidateRates]);

  const [previousSnapshot, previousRates] = await Promise.all([
    readFile(publishedSnapshot),
    readFile(publishedRates),
  ]);

  try {
    await copyFile(candidateSnapshot, publishedSnapshot);
    await copyFile(candidateRates, publishedRates);
  } catch (error) {
    await Promise.all([
      writeFile(publishedSnapshot, previousSnapshot),
      writeFile(publishedRates, previousRates),
    ]);
    throw error;
  }

  console.log("Price snapshot and exchange rates were published together successfully.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
