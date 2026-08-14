import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { discoverPlans, uncoveredItems } from "../app/lib/plan-discovery.mjs";

test("every public item and duplicate occurrence is visible without a manual whitelist", async () => {
  const [snapshot, definitions] = await Promise.all([
    readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/plan-definitions.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  for (const app of snapshot.apps) {
    const plans = discoverPlans(app, definitions[app.id] ?? []);
    assert.deepEqual(uncoveredItems(app, plans), [], `${app.matchedName} still hides public items`);
  }
});

test("plan discovery exposes every storefront row without a fixed plan-count ceiling", () => {
  const app = {
    regions: [{
      region: "us",
      items: Array.from({ length: 12 }, (_, index) => ({
        name: `Public Item ${index + 1}`,
        price: `$${index + 1}.99`,
      })),
    }],
  };
  const plans = discoverPlans(app, []);
  assert.equal(plans.length, 12);
  assert.deepEqual(uncoveredItems(app, plans), []);
});

test("a newly fetched product appears automatically without editing plan definitions", () => {
  const app = {
    regions: [{
      region: "us",
      items: [
        { name: "Known Plan", price: "$9.99" },
        { name: "Brand New Plan", price: "$19.99" },
      ],
    }],
  };
  const plans = discoverPlans(app, [{ id: "known", label: "Known", period: "月付", aliases: ["Known Plan"] }]);
  assert.ok(plans.some((plan) => plan.label === "Brand New Plan" && plan.discovered));
  assert.deepEqual(uncoveredItems(app, plans), []);
});

test("manual definitions cannot invent plans when no official public item exists", () => {
  const app = { regions: [{ region: "us", items: [] }] };
  const plans = discoverPlans(app, [{ id: "stale", label: "Stale Plan", period: "月付", aliases: ["Stale Plan"] }]);
  assert.deepEqual(plans, []);
});

test("global display rules keep subscriptions prominent without dropping other purchases", () => {
  const app = {
    regions: [{
      region: "us",
      items: [
        { name: "Premium Monthly", price: "$9.99" },
        { name: "Premium Annual", price: "$99.99" },
        { name: "1,000 Credits", price: "$4.99" },
        { name: "Sticker Pack", price: "$1.99" },
      ],
    }],
  };
  const plans = discoverPlans(app, []);
  assert.equal(plans.find((plan) => plan.label === "Premium Monthly")?.displayGroup, "primary");
  assert.equal(plans.find((plan) => plan.label === "Premium Annual")?.displayGroup, "primary");
  assert.equal(plans.find((plan) => plan.label === "1,000 Credits")?.displayGroup, "other");
  assert.equal(plans.find((plan) => plan.label === "Sticker Pack")?.displayGroup, "other");
  assert.deepEqual(uncoveredItems(app, plans), []);
});

test("unclassified duplicate purchases keep the first name and number later occurrences", () => {
  const app = {
    regions: [{
      region: "us",
      items: [
        { name: "SVIP", price: "$19.99" },
        { name: "SVIP", price: "$199.99" },
        { name: "SVIP", price: "$299.99" },
      ],
    }],
  };
  const plans = discoverPlans(app, []);
  assert.deepEqual(plans.map((plan) => plan.label), ["SVIP", "SVIP #2", "SVIP #3"]);
  assert.ok(plans.every((plan) => plan.displayGroup === "other"));
});
