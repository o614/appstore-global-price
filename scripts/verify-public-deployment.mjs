import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const markerPath = resolve(option("--marker", "public/deployment-status.json"));
const siteUrl = new URL(option("--url", "https://price.290935.xyz"));
const timeoutSeconds = Number(option("--timeout-seconds", "600"));
const intervalSeconds = Number(option("--interval-seconds", "15"));
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 15 || timeoutSeconds > 1_800) {
  throw new Error("--timeout-seconds must be between 15 and 1800");
}
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 60) {
  throw new Error("--interval-seconds must be between 5 and 60");
}

const expected = JSON.parse(await readFile(markerPath, "utf8"));
const statusUrl = new URL("/deployment-status.json", siteUrl);
const deadline = Date.now() + timeoutSeconds * 1_000;
let attempt = 0;
let lastFailure = "尚未请求";

while (Date.now() < deadline) {
  attempt += 1;
  statusUrl.searchParams.set("expected", expected.id);
  statusUrl.searchParams.set("attempt", String(attempt));
  try {
    const response = await fetch(statusUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const deployed = await response.json();
      if (deployed.id === expected.id) {
        console.log(`Verified public deployment ${expected.id} after ${attempt} attempt(s).`);
        process.exit(0);
      }
      lastFailure = `线上标记为 ${deployed.id ?? "missing"}，等待 ${expected.id}`;
    } else {
      lastFailure = `HTTP ${response.status}`;
    }
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
  }
  console.log(`Deployment not ready (${lastFailure}); retrying in ${intervalSeconds}s.`);
  await delay(intervalSeconds * 1_000);
}

throw new Error(`Cloudflare deployment verification timed out: ${lastFailure}`);
