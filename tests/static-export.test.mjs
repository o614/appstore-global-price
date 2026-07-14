import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function readPage(path) {
  return readFile(new URL(`../out${path}`, import.meta.url), "utf8");
}

test("exports the price comparison homepage as static HTML", async () => {
  const html = await readPage("/index.html");
  assert.match(html, /<title>App Store 全球价格<\/title>/);
  assert.match(html, /先看清价格/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /首批验证目录/);
  assert.match(html, /套餐数量不补齐/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("exports every configured app detail route", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  for (const app of snapshot.apps) {
    await stat(new URL(`../out/apps/${app.id}/index.html`, import.meta.url));
  }

  const html = await readPage("/apps/6448311069/index.html");
  assert.match(html, /ChatGPT 全球内购价格/);
  assert.match(html, /App ID/);
  assert.match(html, /6448311069/);
  assert.match(html, /选择一个套餐进行比较/);
  assert.match(html, /仅对已确认的同一套餐排名/);
  assert.match(html, /分享当前比价/);
  assert.match(html, /查看跳转方式/);
});
