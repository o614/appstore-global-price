import { appendFile, readFile } from "node:fs/promises";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

const pushUrl = process.env.BARK_PUSH_URL?.replace(/\/$/, "");
const githubOutput = option("--github-output");
if (!pushUrl) {
  console.log("::warning::BARK_PUSH_URL is not configured; notification skipped.");
  if (githubOutput) await appendFile(githubOutput, "sent=false\n", "utf8");
  process.exit(0);
}

const event = option("--event", "change");
const summaryPath = option("--summary");
const targetUrl = option("--url", process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions`
  : undefined);
const summary = summaryPath ? JSON.parse(await readFile(summaryPath, "utf8")) : null;
let title;
let body;
let notificationId = "appstore-price-monitor";

if (event === "change") {
  title = "App Store 比价发现变化";
  const lines = [`发现 ${summary?.changeCount ?? 0} 个应用/地区发生变化：`];
  for (const change of summary?.changes?.slice(0, 8) ?? []) {
    if (change.type !== "region-items-changed") {
      lines.push(`${change.appName}：${change.type}`);
      continue;
    }
    const details = [];
    if (change.beforeState !== change.afterState) details.push(`状态 ${change.beforeState}→${change.afterState}`);
    for (const item of change.updated?.slice(0, 2) ?? []) details.push(`${item.name} ${item.beforePrice}→${item.afterPrice}`);
    if ((change.updated?.length ?? 0) > 2) details.push(`另有 ${change.updated.length - 2} 个套餐调价`);
    for (const item of change.added?.slice(0, 1) ?? []) details.push(`新增 ${item.name} ${item.price}`);
    if ((change.added?.length ?? 0) > 1) details.push(`另新增 ${change.added.length - 1} 项`);
    for (const item of change.removed?.slice(0, 1) ?? []) details.push(`移除 ${item.name} ${item.price}`);
    if ((change.removed?.length ?? 0) > 1) details.push(`另移除 ${change.removed.length - 1} 项`);
    lines.push(`${change.appName} / ${change.region.toUpperCase()}：${details.join("，") || "内容变化"}`);
  }
  if ((summary?.changes?.length ?? 0) > 8) lines.push(`另有 ${(summary.changes.length - 8)} 处变化`);
  lines.push("系统会短时复查；两次结果一致后自动发布。");
  body = lines.join("\n");
} else if (event === "published") {
  title = "App Store 订阅变化已上线";
  body = summary?.changed
    ? `已确认并上线 ${summary.changeCount} 个应用/地区的订阅变化。`
    : "本次检查未发现订阅变动，网站数据无需更新。";
} else {
  title = "App Store 价格任务失败";
  body = `${process.env.GITHUB_WORKFLOW ?? "价格任务"} 执行失败，请点击查看日志。`;
  notificationId = "appstore-price-monitor-error";
}

const response = await fetch(pushUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title,
    body,
    group: "App Store 价格监控",
    id: notificationId,
    level: "active",
    url: targetUrl,
  }),
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) throw new Error(`Bark request failed: HTTP ${response.status}`);
const payload = await response.json().catch(() => null);
if (payload && payload.code !== undefined && payload.code !== 200) {
  throw new Error(`Bark rejected notification: ${payload.message ?? payload.code}`);
}
if (githubOutput) await appendFile(githubOutput, "sent=true\n", "utf8");
console.log(`Bark notification sent: ${event}`);
