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

test("Grok exposes every storefront row without a fixed plan-count ceiling", async () => {
  const [snapshot, definitions] = await Promise.all([
    readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/plan-definitions.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const grok = snapshot.apps.find((app) => app.id === "6670324846");
  const plans = discoverPlans(grok, definitions[grok.id]);
  assert.deepEqual(uncoveredItems(grok, plans), []);
  assert.ok(plans.length >= 10, "Grok unexpectedly lost previously published plans");
  assert.ok(plans.some((plan) => plan.label === "SuperGrok" && plan.period === "年付"));
  assert.ok(plans.some((plan) => plan.label === "SuperGrok Lite" && plan.period === "年付"));
  assert.ok(plans.some((plan) => plan.label === "Extra Usage Credits 100 USD"));
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
