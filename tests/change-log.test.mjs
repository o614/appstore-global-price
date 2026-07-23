import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const updater = resolve("scripts/update-price-change-log.mjs");

test("published price changes are appended once and newest first", async () => {
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
      updated: [{ name: "Monthly", beforePrice: "$9.99", afterPrice: "$10.99" }],
      added: [],
      removed: [],
    }],
  };
  await writeFile(diffPath, JSON.stringify(diff), "utf8");
  await writeFile(logPath, JSON.stringify({ version: 1, entries: [] }), "utf8");

  const args = [updater, "--diff", diffPath, "--log", logPath, "--published-at", "2026-07-23T01:00:00.000Z"];
  await execFileAsync(process.execPath, args);
  await execFileAsync(process.execPath, args);

  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].id, "change-123");
  assert.equal(log.entries[0].publishedAt, "2026-07-23T01:00:00.000Z");
  assert.equal(log.entries[0].changes[0].updated[0].afterPrice, "$10.99");
});
