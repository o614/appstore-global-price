import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferCatalogGroup, normalizeCatalogEntries } from "../scripts/catalog-config.mjs";

test("catalog accepts App-ID-only rows and preserves optional grouping", () => {
  const entries = normalizeCatalogEntries([
    "6474233312",
    {
      id: "376510438",
      group: "影音娱乐",
      regionalAppIds: { jp: "549416492" },
      excludeItemNames: ["Tip"],
    },
  ]);
  assert.equal(entries[0].id, "6474233312");
  assert.equal(entries[0].group, undefined);
  assert.equal(entries[1].group, "影音娱乐");
  assert.deepEqual(entries[1].regionalAppIds, { jp: "549416492" });
  assert.deepEqual(entries[1].excludeItemNames, ["Tip"]);
  assert.equal(inferCatalogGroup("Entertainment"), "影音娱乐");
  assert.equal(inferCatalogGroup("Unknown"), "其他应用");
});

test("catalog validates regional App IDs and excluded item names", () => {
  assert.throws(
    () => normalizeCatalogEntries([{ id: "376510438", regionalAppIds: { japan: "549416492" } }]),
    /invalid region code/u,
  );
  assert.throws(
    () => normalizeCatalogEntries([{ id: "376510438", regionalAppIds: { jp: "not-an-id" } }]),
    /invalid regional App ID/u,
  );
  assert.throws(
    () => normalizeCatalogEntries([{ id: "6474233312", excludeItemNames: "Tip" }]),
    /must be an array/u,
  );
});

test("catalog contains the requested apps and excludes removed entries", async () => {
  const config = JSON.parse(await readFile(new URL("../data/catalog-config.json", import.meta.url), "utf8"));
  const entries = normalizeCatalogEntries(config.apps);
  const ids = entries.map((entry) => entry.id);
  for (const id of [
    "6474233312",
    "835599320",
    "1666653815",
    "317469184",
    "1446075923",
    "376510438",
  ]) {
    assert.ok(ids.includes(id), `missing App ID ${id}`);
  }
  assert.equal(ids.includes("1451784328"), false, "Google One should be removed");
  assert.equal(ids.includes("547166701"), false, "百度网盘 should be removed");
  assert.equal(ids.includes("6737597349"), false, "DeepSeek should be removed");
  assert.equal(ids.includes("530168168"), false, "Paramount+ should be removed");
  assert.equal(ids.length, 21);
  assert.deepEqual(entries.find((entry) => entry.id === "376510438")?.regionalAppIds, { jp: "549416492" });
  assert.equal(entries.find((entry) => entry.id === "6474233312")?.excludeItemNames.length, 4);
});
