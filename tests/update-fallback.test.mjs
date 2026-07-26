import assert from "node:assert/strict";
import test from "node:test";
import { isPublishableRegion, resolveRegionWithFallback } from "../scripts/update-fallback.mjs";

const verified = {
  region: "us",
  status: "ok-itemsV3",
  itemCount: 1,
  items: [{ name: "Monthly", price: "$9.99" }],
};

test("keeps valid current results and treats official unavailability as publishable", () => {
  assert.equal(isPublishableRegion(verified), true);
  assert.equal(isPublishableRegion({ region: "us", status: "error:HTTP 404", itemCount: 0, items: [] }), true);
  assert.equal(isPublishableRegion({ region: "us", status: "error:HTTP 500", itemCount: 0, items: [] }), false);
});

test("falls back per region after a transient failure without turning it into an empty price", () => {
  const result = resolveRegionWithFallback({
    appId: "123",
    regionCode: "us",
    candidate: { region: "us", status: "error:HTTP 500", itemCount: 0, items: [] },
    fallbackSnapshot: { apps: [{ id: "123", regions: [verified] }] },
  });
  assert.deepEqual(result.region, verified);
  assert.deepEqual(result.fallback, { appId: "123", region: "us", reason: "error:HTTP 500" });
});

test("defers a new app when no verified fallback exists", () => {
  const result = resolveRegionWithFallback({
    appId: "456",
    regionCode: "us",
    candidate: { region: "us", status: "error:parser-changed", itemCount: 0, items: [] },
    fallbackSnapshot: { apps: [] },
  });
  assert.equal(result.region, null);
  assert.equal(result.fallback, null);
});
