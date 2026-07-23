import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const updater = resolve("scripts/update-price-change-log.mjs");

test("published price changes are compact, capped, and appended once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "appstore-change-log-"));
  const diffPath = join(directory, "diff.json");
  const logPath = join(directory, "log.json");
  const diff = {
    changed: true,
    fingerprint: "change-123",
    changeCount: 1,
    checkedAt: "2026-07-23T00:00:00.000Z",
    changes: [{
      type: "region-items-changed",
      appId: "1",
      appName: "Example",
      region: "us",
      beforeState: "verified",
      afterState: "verified",
      beforeCount: 2,
      afterCount: 2,
      beforeStatus: "verified",
      afterStatus: "verified",
      updated: [{ name: "Monthly", beforePrice: "$9.99", afterPrice: "$10.99", source: "internal" }],
      added: [],
      removed: [],
    }],
  };
  await writeFile(diffPath, JSON.stringify(diff), "utf8");
  const oldEntries = Array.from({ length: 35 }, (_, index) => ({
    id: `old-${index}`,
    publishedAt: `2026-07-${String(22 - (index % 20)).padStart(2, "0")}T01:00:00.000Z`,
    checkedAt: "internal-only",
    changeCount: 1,
    changes: [{
      type: "region-items-changed",
      appId: "2",
      appName: "Old example",
      region: "us",
      beforeState: "verified",
      afterState: "service-unavailable",
      beforeCount: 1,
      removed: [{ name: "Monthly", price: "$9.99", source: "internal" }],
    }],
  }));
  await writeFile(logPath, JSON.stringify({ version: 1, entries: oldEntries }), "utf8");

  const args = [updater, "--diff", diffPath, "--log", logPath, "--published-at", "2026-07-23T01:00:00.000Z"];
  await execFileAsync(process.execPath, args);
  await execFileAsync(process.execPath, args);

  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.equal(log.entries.length, 30);
  assert.equal(log.entries[0].id, "change-123");
  assert.equal(log.entries[0].publishedAt, "2026-07-23T01:00:00.000Z");
  assert.equal(log.entries[0].changes[0].updated[0].afterPrice, "$10.99");
  assert.deepEqual(Object.keys(log.entries[0]).sort(), ["changeCount", "changes", "id", "publishedAt"].sort());
  assert.equal("beforeCount" in log.entries[0].changes[0], false);
  assert.equal("source" in log.entries[0].changes[0].updated[0], false);
  assert.equal("checkedAt" in log.entries[1], false);
});
