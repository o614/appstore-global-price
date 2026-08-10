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
    "1668000334",
    "570060128",
    "1500855883",
    "288429040",
    "1636235979",
    "447188370",
    "6445905219",
    "1232780281",
    "985746746",
    "1442620678",
    "1451784328",
    "1136220934",
    "1511601750",
    "1444383602",
    "360593530",
    "541164041",
    "1477376905",
    "1630403500",
    "1423538627",
    "6767085653",
    "327630330",
    "992180193",
    "426826309",
    "626144601",
    "640199958",
  ]) {
    assert.ok(ids.includes(id), `missing App ID ${id}`);
  }
  for (const id of ["1666653815", "1446075923", "376510438", "317469184"]) {
    assert.equal(ids.includes(id), false, `removed App ID ${id} should stay out of the catalog`);
  }
  assert.equal(ids.includes("547166701"), false, "百度网盘 should be removed");
  assert.equal(ids.includes("6737597349"), false, "DeepSeek should be removed");
  assert.equal(ids.includes("530168168"), false, "Paramount+ should be removed");
  assert.equal(ids.length, 42);
  assert.equal(ids[0], "640199958", "Apple services should be listed before AI tools");
  assert.ok(ids.indexOf("1108187390") < ids.indexOf("6448311069"), "Apple services should precede AI tools");
  assert.equal(entries.some((entry) => entry.excludeItemNames?.length), false, "catalog items should use the global display rules");
});
