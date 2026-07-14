import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the price comparison homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>App Store 全球价格<\/title>/);
  assert.match(html, /先看清价格/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /首批验证目录/);
  assert.match(html, /套餐数量不补齐/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("server-renders an app comparison detail page", async () => {
  const response = await render("/apps/6448311069");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChatGPT 全球内购价格/);
  assert.match(html, /App ID/);
  assert.match(html, /6448311069/);
  assert.match(html, /选择一个套餐进行比较/);
  assert.match(html, /仅对已确认的同一套餐排名/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /月付/);
  assert.match(html, /年付/);
  assert.match(html, /100 Credits/);
  assert.match(html, /https:\/\/apps\.apple\.com\/us\/app\/id6448311069/);
});
