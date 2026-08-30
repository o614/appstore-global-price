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

test("catalog contains only Apple services and selected AI tools", async () => {
  const config = JSON.parse(await readFile(new URL("../data/catalog-config.json", import.meta.url), "utf8"));
  const entries = normalizeCatalogEntries(config.apps);
  const ids = entries.map((entry) => entry.id);
  assert.deepEqual(ids, [
    "640199958",
    "1108187390",
    "apple-icloud-plus",
    "apple-one",
    "apple-tv-plus",
    "apple-arcade",
    "apple-fitness-plus",
    "apple-news-plus",
    "6448311069",
    "6473753684",
    "6477489729",
    "6670324846",
    "6474233312",
    "1668000334",
  ]);
  for (const id of ["686449807", "570060128", "1451784328", "1477376905", "363590051", "426826309"]) {
    assert.equal(ids.includes(id), false, `removed App ID ${id} should stay out of the catalog`);
  }
  assert.ok(entries.every((entry) => entry.group === "Apple 服务" || entry.group === "AI 助手"));
  assert.equal(ids.length, 14);
  assert.equal(ids[0], "640199958", "Apple services should be listed before AI tools");
  assert.ok(ids.indexOf("1108187390") < ids.indexOf("6448311069"), "Apple services should precede AI tools");
  assert.equal(entries.some((entry) => entry.excludeItemNames?.length), false, "catalog items should use the global display rules");
});
