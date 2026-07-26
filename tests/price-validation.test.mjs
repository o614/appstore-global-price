import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("snapshot validation rejects a price without a numeric amount", async () => {
  const directory = await mkdtemp(join(tmpdir(), "price-validation-"));
  try {
    const snapshot = JSON.parse(await readFile("data/validation-snapshot.json", "utf8"));
    const app = snapshot.apps.find((candidate) => candidate.regions.some((region) => region.items.length));
    const region = app.regions.find((candidate) => candidate.items.length);
    region.items[0].price = "₹";
    const snapshotPath = join(directory, "snapshot.json");
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        "scripts/validate-price-snapshot.mjs",
        "--snapshot",
        snapshotPath,
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /contains an invalid price/u);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot validation allows a failed new app to be deferred without dropping published apps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "price-validation-deferred-"));
  try {
    const snapshot = JSON.parse(await readFile("data/validation-snapshot.json", "utf8"));
    const config = JSON.parse(await readFile("data/catalog-config.json", "utf8"));
    config.apps.push({ id: "9999999999", group: "其他应用" });
    snapshot.updateReport = {
      fallbackCount: 0,
      fallbacks: [],
      deferredApps: [{ appId: "9999999999", reason: "metadata:temporary failure" }],
    };
    const snapshotPath = join(directory, "snapshot.json");
    const configPath = join(directory, "catalog.json");
    await Promise.all([
      writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8"),
      writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8"),
    ]);

    await execFileAsync(process.execPath, [
      "scripts/validate-price-snapshot.mjs",
      "--snapshot",
      snapshotPath,
      "--config",
      configPath,
      "--previous",
      "data/validation-snapshot.json",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot validation refuses to defer an app that was already published", async () => {
  const directory = await mkdtemp(join(tmpdir(), "price-validation-existing-"));
  try {
    const snapshot = JSON.parse(await readFile("data/validation-snapshot.json", "utf8"));
    const removed = snapshot.apps.pop();
    snapshot.updateReport = {
      fallbackCount: 0,
      fallbacks: [],
      deferredApps: [{ appId: removed.id, reason: "temporary failure" }],
    };
    const snapshotPath = join(directory, "snapshot.json");
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        "scripts/validate-price-snapshot.mjs",
        "--snapshot",
        snapshotPath,
        "--previous",
        "data/validation-snapshot.json",
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /must use verified fallback data/u);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
