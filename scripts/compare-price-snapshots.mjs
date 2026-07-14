import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const beforePath = resolve(option("--before", "data/validation-snapshot.json"));
const afterPath = resolve(option("--after", ".tmp/price-snapshot.json"));
const jsonPath = resolve(option("--json", ".tmp/price-diff.json"));
const markdownPath = resolve(option("--markdown", ".tmp/price-diff.md"));
const githubOutput = option("--github-output");
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));

function itemKey(item) {
  return `${item.name}\u0000${item.price}`;
}

function subtract(left, right) {
  const remaining = new Map();
  for (const item of right) remaining.set(itemKey(item), (remaining.get(itemKey(item)) ?? 0) + 1);
  return left.filter((item) => {
    const key = itemKey(item);
    const count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

function availability(status) {
  return status === "error:HTTP 404" ? "unavailable" : "available";
}

const changes = [];
const appIds = new Set([...(before.apps ?? []).map((app) => app.id), ...(after.apps ?? []).map((app) => app.id)]);
for (const appId of appIds) {
  const oldApp = before.apps?.find((app) => app.id === appId);
  const newApp = after.apps?.find((app) => app.id === appId);
  if (!oldApp || !newApp) {
    changes.push({ type: oldApp ? "app-removed" : "app-added", appId, appName: oldApp?.matchedName ?? newApp?.matchedName ?? appId });
    continue;
  }
  const regions = new Set([...(oldApp.regions ?? []).map((region) => region.region), ...(newApp.regions ?? []).map((region) => region.region)]);
  for (const regionCode of regions) {
    const oldRegion = oldApp.regions?.find((region) => region.region === regionCode);
    const newRegion = newApp.regions?.find((region) => region.region === regionCode);
    if (!oldRegion || !newRegion) {
      changes.push({
        type: oldRegion ? "region-removed" : "region-added",
        appId,
        appName: newApp.matchedName,
        region: regionCode,
      });
      continue;
    }
    const oldItems = oldRegion.items ?? [];
    const newItems = newRegion.items ?? [];
    const removed = subtract(oldItems, newItems);
    const added = subtract(newItems, oldItems);
    // Apple occasionally reorders the same products on the storefront page.
    // Treat the lists as multisets so a presentation-only reorder does not
    // generate a new fingerprint or a noisy Bark notification.
    const itemsChanged = removed.length > 0 || added.length > 0;
    const availabilityChanged = availability(oldRegion.status) !== availability(newRegion.status);
    if (!itemsChanged && !availabilityChanged) continue;
    changes.push({
      type: "region-items-changed",
      appId,
      appName: newApp.matchedName,
      region: regionCode,
      beforeCount: oldItems.length,
      afterCount: newItems.length,
      beforeAvailability: availability(oldRegion.status),
      afterAvailability: availability(newRegion.status),
      removed,
      added,
    });
  }
}

const fingerprint = changes.length
  ? createHash("sha256").update(JSON.stringify(changes)).digest("hex").slice(0, 20)
  : "none";
const result = {
  changed: changes.length > 0,
  fingerprint,
  changeCount: changes.length,
  checkedAt: after.generatedAt,
  changes,
};

const markdown = changes.length
  ? [
      "# App Store 价格变化",
      "",
      `共发现 ${changes.length} 个应用/地区发生变化。`,
      "",
      ...changes.flatMap((change) => {
        if (change.type !== "region-items-changed") return [`- **${change.appName}**：${change.type}`];
        const details = [];
        if (change.beforeCount !== change.afterCount) details.push(`套餐 ${change.beforeCount} → ${change.afterCount}`);
        if (change.beforeAvailability !== change.afterAvailability) details.push(`可用状态 ${change.beforeAvailability} → ${change.afterAvailability}`);
        for (const item of change.removed) details.push(`移除「${item.name} · ${item.price}」`);
        for (const item of change.added) details.push(`新增「${item.name} · ${item.price}」`);
        return [`- **${change.appName} / ${change.region.toUpperCase()}**：${details.join("；") || "项目顺序变化"}`];
      }),
      "",
      `检测时间：${after.generatedAt}`,
    ].join("\n")
  : `# App Store 价格变化\n\n未发现变化。\n\n检测时间：${after.generatedAt}\n`;

await mkdir(dirname(jsonPath), { recursive: true });
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(markdownPath, `${markdown}\n`, "utf8");
if (githubOutput) {
  await appendFile(githubOutput, `changed=${result.changed}\nfingerprint=${fingerprint}\nchange_count=${changes.length}\n`, "utf8");
}
console.log(changes.length ? `Detected ${changes.length} changed app/region entries (${fingerprint}).` : "No price changes detected.");
