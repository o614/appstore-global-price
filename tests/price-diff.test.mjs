import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const comparator = resolve("scripts/compare-price-snapshots.mjs");

function snapshot(items, status = "ok-itemsV3") {
  return {
    generatedAt: "2026-07-14T00:00:00.000Z",
    apps: [
      {
        id: "1",
        matchedName: "Example",
        regions: [{ region: "us", status, itemCount: items.length, items }],
      },
    ],
  };
}

async function compare(beforeItems, afterItems, beforeStatus = "ok-itemsV3", afterStatus = "ok-itemsV3") {
  const directory = await mkdtemp(join(tmpdir(), "appstore-price-diff-"));
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  const json = join(directory, "diff.json");
  const markdown = join(directory, "diff.md");
  await writeFile(before, JSON.stringify(snapshot(beforeItems, beforeStatus)), "utf8");
  await writeFile(after, JSON.stringify(snapshot(afterItems, afterStatus)), "utf8");
  await execFileAsync(process.execPath, [comparator, "--before", before, "--after", after, "--json", json, "--markdown", markdown]);
  return JSON.parse(await readFile(json, "utf8"));
}

test("price monitor ignores presentation-only product reordering", async () => {
  const first = { name: "Monthly", price: "$9.99" };
  const second = { name: "Annual", price: "$99.99" };
  const result = await compare([first, second], [second, first]);
  assert.equal(result.changed, false);
  assert.equal(result.changeCount, 0);
  assert.equal(result.fingerprint, "none");
});

test("price monitor still detects a real price change", async () => {
  const result = await compare([{ name: "Monthly", price: "$9.99" }], [{ name: "Monthly", price: "$10.99" }]);
  assert.equal(result.changed, true);
  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.changes[0].updated, [{ name: "Monthly", beforePrice: "$9.99", afterPrice: "$10.99" }]);
  assert.deepEqual(result.changes[0].removed, []);
  assert.deepEqual(result.changes[0].added, []);
});

test("price monitor keeps unavailable, unpublished, and parse failure states distinct", async () => {
  const unavailable = await compare([], [], "official-price-page-missing", "service-unavailable");
  assert.equal(unavailable.changes[0].beforeState, "official-price-unpublished");
  assert.equal(unavailable.changes[0].afterState, "service-unavailable");

  const parseFailure = await compare(
    [{ name: "Monthly", price: "$9.99" }],
    [],
    "ok-itemsV3",
    "error:parser-changed",
  );
  assert.equal(parseFailure.changes[0].beforeState, "verified");
  assert.equal(parseFailure.changes[0].afterState, "parse-failed");
  assert.deepEqual(parseFailure.changes[0].removed, []);
});

test("catalog additions remain internal and do not create a public subscription change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "appstore-price-catalog-diff-"));
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  const json = join(directory, "diff.json");
  const markdown = join(directory, "diff.md");
  await writeFile(before, JSON.stringify({ generatedAt: "2026-07-14T00:00:00.000Z", apps: [] }), "utf8");
  await writeFile(after, JSON.stringify(snapshot([{ name: "Monthly", price: "$9.99" }])), "utf8");
  await execFileAsync(process.execPath, [
    comparator,
    "--before", before,
    "--after", after,
    "--json", json,
    "--markdown", markdown,
  ]);
  const result = JSON.parse(await readFile(json, "utf8"));
  assert.equal(result.changed, false);
  assert.equal(result.changeCount, 0);
  assert.equal(result.catalogOperations.length, 1);
  assert.equal(result.catalogOperations[0].type, "app-added");
});
