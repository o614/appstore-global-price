import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const snapshotPath = resolve(process.argv[2] ?? ".tmp/price-snapshot.json");
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const report = snapshot.updateReport ?? { fallbackCount: 0, fallbacks: [], deferredApps: [] };

console.log("## 自动更新降级报告\n");
if (!report.fallbackCount && !report.deferredApps?.length) {
  console.log("本次所有应用均正常完成，没有触发降级。\n");
} else {
  console.log(`- 复用上一版已验证数据：${report.fallbackCount ?? report.fallbacks?.length ?? 0} 项`);
  console.log(`- 暂缓首次发布的新应用：${report.deferredApps?.length ?? 0} 个\n`);
  for (const entry of report.deferredApps ?? []) {
    console.log(`  - App ID ${entry.appId}${entry.region ? ` / ${entry.region}` : ""}：${entry.reason}`);
  }
  if (report.deferredApps?.length) console.log("");
}
