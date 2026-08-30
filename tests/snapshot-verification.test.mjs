import assert from "node:assert/strict";
import test from "node:test";
import { retainVerifiedSnapshot, stampVerifiedApps } from "../scripts/snapshot-verification.mjs";

const previous = {
  generatedAt: "2026-08-01T00:00:00.000Z",
  apps: [
    { id: "fresh", verifiedAt: "2026-07-31T00:00:00.000Z" },
    { id: "fallback", verifiedAt: "2026-07-30T00:00:00.000Z" },
  ],
};

test("successful apps receive the current verification time while fallbacks preserve the previous time", () => {
  const current = {
    generatedAt: "2026-08-02T00:00:00.000Z",
    apps: [{ id: "fresh" }, { id: "fallback" }],
    updateReport: {
      fallbacks: [{ appId: "fallback", reason: "transient" }],
      deferredApps: [],
    },
  };
  const result = stampVerifiedApps(current, previous);
  assert.equal(result.apps[0].verifiedAt, current.generatedAt);
  assert.equal(result.apps[1].verifiedAt, "2026-07-30T00:00:00.000Z");
});

test("retaining a failed batch never advances its app verification time", () => {
  const retained = retainVerifiedSnapshot(previous, ["fallback"]);
  assert.deepEqual(retained.apps, [
    { id: "fallback", verifiedAt: "2026-07-30T00:00:00.000Z" },
  ]);
});
