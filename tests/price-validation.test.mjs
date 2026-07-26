import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("snapshot validation rejects a price without a numeric amount", async () => {
  const directory = await mkdtemp(join(tmpdir(), "price-validation-"));
  try {
    const snapshot = JSON.parse(await readFile("data/validation-snapshot.json", "utf8"));
    const app = snapshot.apps.find((candidate) => candidate.regions.some((region) => region.items.length));
    const region = app.regions.find((candidate) => candidate.items.length);
    region.items[0].price = "₹";
    const snapshotPath = join(directory, "snapshot.json");
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [
        "scripts/validate-price-snapshot.mjs",
        "--snapshot",
        snapshotPath,
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /contains an invalid price/u);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
