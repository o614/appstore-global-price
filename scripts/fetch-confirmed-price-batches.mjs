import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(option("--config", "data/catalog-config.json"));
const regionsPath = resolve(option("--regions", "data/regions.json"));
const fallbackPath = resolve(option("--fallback", "data/validation-snapshot.json"));
const outputPath = resolve(option("--output", ".tmp/price-snapshot-confirmed.json"));
const batchSize = Number(option("--batch-size", "3"));
const confirmationDelaySeconds = Number(option("--confirmation-delay-seconds", "480"));

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
  throw new Error("Batch size must be an integer between 1 and 10");
}
if (!Number.isFinite(confirmationDelaySeconds) || confirmationDelaySeconds < 0) {
  throw new Error("Confirmation delay must be a non-negative number");
}

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

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function partialSnapshot(snapshot, ids) {
  const allowed = new Set(ids);
  return {
    ...snapshot,
    apps: (snapshot.apps ?? []).filter((app) => allowed.has(String(app.id))),
    updateReport: { fallbackCount: 0, fallbacks: [], deferredApps: [] },
  };
}

function reportFrom(snapshot) {
  return snapshot?.updateReport ?? { fallbackCount: 0, fallbacks: [], deferredApps: [] };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchBatch({ directory, batch, previous, suffix }) {
  const ids = batch.map((entry) => String(entry.id));
  const config = resolve(directory, `catalog-${suffix}.json`);
  const fallback = resolve(directory, `fallback-${suffix}.json`);
  const snapshot = resolve(directory, `snapshot-${suffix}.json`);
  const diff = resolve(directory, `diff-${suffix}.json`);
  const markdown = resolve(directory, `diff-${suffix}.md`);
  await writeJson(config, { apps: batch });
  await writeJson(fallback, partialSnapshot(previous, ids));
  await run("scripts/fetch-price-snapshot.mjs", [
    "--config", config,
    "--regions", regionsPath,
    "--output", snapshot,
    "--fallback", fallback,
    "--app-batch-size", String(batch.length),
  ]);
  await run("scripts/validate-price-snapshot.mjs", [
    "--snapshot", snapshot,
    "--config", config,
    "--regions", regionsPath,
    "--previous", fallback,
  ]);
  await run("scripts/compare-price-snapshots.mjs", [
    "--before", fallback,
    "--after", snapshot,
    "--json", diff,
    "--markdown", markdown,
  ]);
  return { snapshot: await readJson(snapshot), diff: await readJson(diff) };
}

const [config, previous, regionData] = await Promise.all([
  readJson(configPath),
  readJson(fallbackPath),
  readJson(regionsPath),
]);
const catalogEntries = config.apps ?? [];
const batches = Array.from(
  { length: Math.ceil(catalogEntries.length / batchSize) },
  (_, index) => catalogEntries.slice(index * batchSize, (index + 1) * batchSize),
);
const temporaryDirectory = resolve(root, ".tmp", `confirmed-batches-${process.pid}-${Date.now()}`);
await mkdir(temporaryDirectory, { recursive: true });

const states = [];
try {
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    console.log(`First pass ${index + 1}/${batches.length}: ${batch.map((entry) => entry.id).join(", ")}`);
    try {
      const first = await fetchBatch({
        directory: temporaryDirectory,
        batch,
        previous,
        suffix: `first-${index + 1}`,
      });
      states.push({ batch, index, first, accepted: first.diff.changed === true ? null : first.snapshot });
    } catch (error) {
      console.warn(`Batch ${index + 1} failed; retaining its previous verified data: ${error.message}`);
      states.push({ batch, index, error, accepted: partialSnapshot(previous, batch.map((entry) => String(entry.id))) });
    }
  }

  const changedStates = states.filter((state) => state.first?.diff?.changed === true);
  if (changedStates.length && confirmationDelaySeconds > 0) {
    console.log(`Waiting ${confirmationDelaySeconds} seconds before rechecking ${changedStates.length} changed batch(es)...`);
    await delay(confirmationDelaySeconds * 1000);
  }

  for (const state of changedStates) {
    console.log(`Confirmation pass ${state.index + 1}/${batches.length}: ${state.batch.map((entry) => entry.id).join(", ")}`);
    try {
      const second = await fetchBatch({
        directory: temporaryDirectory,
        batch: state.batch,
        previous,
        suffix: `second-${state.index + 1}`,
      });
      const confirmed = second.diff.changed === true
        && state.first.diff.fingerprint !== "none"
        && state.first.diff.fingerprint === second.diff.fingerprint;
      if (confirmed) {
        state.accepted = second.snapshot;
        state.confirmed = true;
      } else {
        console.warn(`Batch ${state.index + 1} did not reproduce the same change; retaining previous verified data.`);
        state.accepted = partialSnapshot(previous, state.batch.map((entry) => String(entry.id)));
        state.confirmationMismatch = true;
      }
    } catch (error) {
      console.warn(`Batch ${state.index + 1} confirmation failed; retaining previous verified data: ${error.message}`);
      state.accepted = partialSnapshot(previous, state.batch.map((entry) => String(entry.id)));
      state.error = error;
    }
  }

  const acceptedById = new Map(
    states.flatMap((state) => state.accepted?.apps ?? []).map((app) => [String(app.id), app]),
  );
  const fallbacks = states.flatMap((state) => {
    const report = reportFrom(state.accepted);
    const batchFallbacks = report.fallbacks ?? [];
    if (!state.error && !state.confirmationMismatch) return batchFallbacks;
    const reason = state.confirmationMismatch ? "batch-confirmation-mismatch" : `batch:${state.error.message}`;
    return [
      ...batchFallbacks,
      ...state.batch.map((entry) => ({ appId: String(entry.id), reason })),
    ];
  });
  const deferredApps = states.flatMap((state) => reportFrom(state.accepted).deferredApps ?? []);
  const output = {
    generatedAt: new Date().toISOString(),
    source: "Apple public App Store product and service pricing pages",
    regions: regionData.regions?.map((region) => region.code) ?? previous.regions,
    apps: catalogEntries.map((entry) => acceptedById.get(String(entry.id))).filter(Boolean),
    updateReport: {
      fallbackCount: fallbacks.length,
      fallbacks,
      deferredApps,
      batches: states.map((state) => ({
        appIds: state.batch.map((entry) => String(entry.id)),
        status: state.confirmed ? "confirmed-change" : state.error ? "fallback" : state.confirmationMismatch ? "unconfirmed" : "verified-unchanged",
      })),
    },
  };
  await writeJson(outputPath, output);
  console.log(`Saved ${output.apps.length}/${catalogEntries.length} apps from ${batches.length} independent batches.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
