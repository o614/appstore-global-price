import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("scheduled price updates require two matching snapshots before publishing", async () => {
  const workflow = await readFile(resolve(".github/workflows/monitor-prices.yml"), "utf8");
  assert.match(workflow, /timezone: "Asia\/Shanghai"/u);
  assert.match(workflow, /sleep 480/u);
  assert.match(workflow, /confirm-price-change\.mjs/u);
  assert.match(workflow, /verify-public-deployment\.mjs/u);
  assert.ok(
    workflow.indexOf("验证 Cloudflare 线上部署") < workflow.indexOf("发送 Bark 上线结果"),
    "Bark success notification must follow public deployment verification",
  );
});

test("static responses include security headers and deployment marker bypasses cache", async () => {
  const headers = await readFile(resolve("public/_headers"), "utf8");
  assert.match(headers, /Content-Security-Policy:/u);
  assert.match(headers, /frame-ancestors 'none'/u);
  assert.match(headers, /X-Content-Type-Options: nosniff/u);
  assert.match(headers, /Permissions-Policy:/u);
  assert.match(headers, /\/deployment-status\.json[\s\S]*Cache-Control: no-store/u);
});

test("deployment marker is deterministic for the published snapshot and rates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "appstore-deployment-marker-"));
  const snapshotPath = join(directory, "snapshot.json");
  const ratesPath = join(directory, "rates.json");
  const firstOutput = join(directory, "first.json");
  const secondOutput = join(directory, "second.json");
  await writeFile(snapshotPath, JSON.stringify({ generatedAt: "2026-07-30T00:00:00.000Z" }), "utf8");
  await writeFile(ratesPath, JSON.stringify({ updatedAt: "Thu, 30 Jul 2026 00:02:31 +0000" }), "utf8");
  const markerScript = resolve("scripts/write-deployment-marker.mjs");
  for (const output of [firstOutput, secondOutput]) {
    await execFileAsync(process.execPath, [
      markerScript,
      "--snapshot", snapshotPath,
      "--rates", ratesPath,
      "--output", output,
    ]);
  }
  const first = JSON.parse(await readFile(firstOutput, "utf8"));
  const second = JSON.parse(await readFile(secondOutput, "utf8"));
  assert.equal(first.id, second.id);
  assert.equal(first.snapshotGeneratedAt, "2026-07-30T00:00:00.000Z");
});

test("price confirmation safely ignores inconsistent fingerprints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "appstore-price-confirmation-"));
  const firstPath = join(directory, "first.json");
  const secondPath = join(directory, "second.json");
  const outputPath = join(directory, "github-output.txt");
  await writeFile(firstPath, JSON.stringify({ changed: true, fingerprint: "first" }), "utf8");
  await writeFile(secondPath, JSON.stringify({ changed: true, fingerprint: "second" }), "utf8");
  await execFileAsync(process.execPath, [
    resolve("scripts/confirm-price-change.mjs"),
    "--first", firstPath,
    "--second", secondPath,
    "--github-output", outputPath,
  ]);
  assert.match(await readFile(outputPath, "utf8"), /confirmed=false/u);
});
