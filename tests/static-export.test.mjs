import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { discoverPlans } from "../app/lib/plan-discovery.mjs";

async function readPage(path) {
  const html = await readFile(new URL(`../out${path}`, import.meta.url), "utf8");
  return html.replaceAll("<!-- -->", "");
}

function escapeHtmlText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

test("exports the price comparison homepage as static HTML", async () => {
  const html = await readPage("/index.html");
  assert.match(html, /<title>App Store 订阅比价<\/title>/);
  assert.match(html, /先看清价格/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /应用与订阅服务/);
  assert.match(html, /浏览应用/);
  assert.match(html, /为什么固定这 20 个地区/);
  assert.match(html, /覆盖常用 Apple ID 地区、主要币种与价格差异明显的市场/);
  assert.match(html, /找出低价不是目的，能够优惠订阅才是王道/);
  assert.doesNotMatch(html, /固定同一组地区，才能让不同应用和不同时间的结果保持可比/);
  assert.doesNotMatch(html, /class="app-group-heading"/);
  assert.doesNotMatch(html, /<span>(?:Productivity|Entertainment|Social Networking|Photo &amp; Video)<\/span>/);
  assert.doesNotMatch(html, /class="hero-stats"/);
  assert.doesNotMatch(html, /已验证价格页/);
  assert.match(html, /系统每天自动检测 3 次/);
  assert.match(html, /订阅变动/);
  assert.match(html, /© 2026 App Store 订阅比价/);
  assert.match(html, /href="https:\/\/stats\.uptimerobot\.com\/WdwUGk8mc9"[^>]*>.*系统状态/s);
  assert.doesNotMatch(html, /class="footer-directory"/);
  assert.doesNotMatch(html, /价格服务|文章教程|联系作者|注册教程|改区教程|充值教程|更多教程|联系客服|LINUX DO/);
  assert.doesNotMatch(html, /购买服务|微信：ehpass|分享网站|快捷入口/);
  assert.match(html, /比较任意 App 与 Apple 订阅服务在固定 20 个地区的官方价格/);
  assert.doesNotMatch(html, /组地区价格已验证/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("exports the fixed-20-region custom app search entry", async () => {
  const html = await readPage("/search/index.html");
  assert.match(html, /查找 App/);
  assert.match(html, /输入应用名称、App ID 或 App Store 链接/);
  assert.doesNotMatch(html, /仍只比较固定 20 个地区|不会加入精选目录或订阅变动日志/);
  const routes = JSON.parse(await readFile(new URL("../out/_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes.include, ["/api/*"]);
});

test("exports every configured app detail route", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  const planDefinitions = JSON.parse(await readFile(new URL("../data/plan-definitions.json", import.meta.url), "utf8"));
  for (const app of snapshot.apps) {
    await stat(new URL(`../out/apps/${app.id}/index.html`, import.meta.url));
  }

  const html = await readPage("/apps/6448311069/index.html");
  assert.match(html, /ChatGPT 订阅比价/);
  assert.match(html, /App ID/);
  assert.match(html, /6448311069/);
  assert.match(html, /选择套餐，查看各地区价格/);
  assert.match(html, /同套餐、同周期比较/);
  assert.match(html, /地区有价格/);
  assert.match(html, /个购买项目/);
  assert.doesNotMatch(html, /<th class="col-status">状态<\/th>/);
  assert.doesNotMatch(html, /Apple 已验证|参考最低<\/span><\/td>/);
  assert.doesNotMatch(html, /日汇率折算/);
  assert.match(html, /分享比价/);
  assert.doesNotMatch(html, /查看跳转方式|查看官方方案/);
  assert.doesNotMatch(html, /当前设备不直接切换 App Store|已识别为 iPhone|系统分享|扫码查看完整地区价格/);

  const netflixHtml = await readPage("/apps/363590051/index.html");
  const netflix = snapshot.apps.find((app) => app.id === "363590051");
  assert.ok(netflix, "Netflix is missing from the snapshot");
  assert.ok(netflix.regions.some((region) => region.itemCount > 0), "Netflix has no public regional prices");
  assert.match(netflixHtml, /Netflix/);
  assert.match(netflixHtml, /363590051/);

  for (const [id, name] of [
    ["640199958", "Apple Developer"],
    ["6474233312", "Kimi"],
    ["835599320", "TikTok"],
    ["1668000334", "Perplexity"],
    ["570060128", "Duolingo"],
    ["1500855883", "CapCut"],
    ["985746746", "Discord"],
    ["1451784328", "Google One"],
    ["6767085653", "Cursor"],
    ["426826309", "Strava"],
  ]) {
    const app = snapshot.apps.find((candidate) => candidate.id === id);
    assert.ok(app?.matchedName.includes(name), `${name} is missing from the snapshot`);
    await stat(new URL(`../out/apps/${id}/index.html`, import.meta.url));
  }
  for (const id of ["1666653815", "1446075923", "376510438", "317469184"]) {
    assert.equal(snapshot.apps.some((app) => app.id === id), false);
  }
  assert.equal(snapshot.apps.some((app) => app.id === "547166701"), false);
  assert.equal(snapshot.apps.some((app) => app.id === "6737597349"), false);
  assert.equal(snapshot.apps.some((app) => app.id === "530168168"), false);

  const kimi = snapshot.apps.find((app) => app.id === "6474233312");
  assert.ok(kimi, "Kimi is missing from the snapshot");
  const kimiPlans = discoverPlans(kimi, planDefinitions["6474233312"]);
  assert.ok(kimiPlans.length > 0, "Kimi has no public purchase items");
  assert.match(await readPage("/apps/6473753684/index.html"), /其他购买项目/);

  const claudeHtml = await readPage("/apps/6473753684/index.html");
  const claude = snapshot.apps.find((app) => app.id === "6473753684");
  assert.ok(claude, "Claude is missing from the snapshot");
  const claudePlans = discoverPlans(claude, planDefinitions[claude.id]);
  assert.ok(claudePlans.length > 0, "Claude has no public purchase items");
  assert.equal(
    (claudeHtml.match(/<button[^>]*class="plan-chip/g) ?? []).length,
    claudePlans.length,
  );

  const appleMusicHtml = await readPage("/apps/1108187390/index.html");
  assert.match(appleMusicHtml, /Apple Music 个人方案/);
  assert.match(appleMusicHtml, /Apple Music 家庭方案/);
  assert.match(appleMusicHtml, /Apple Music 学生方案/);
  assert.doesNotMatch(appleMusicHtml, /查看官方方案/);

  const grokHtml = await readPage("/apps/6670324846/index.html");
  const grok = snapshot.apps.find((app) => app.id === "6670324846");
  assert.ok(grok, "Grok is missing from the snapshot");
  const grokPlans = discoverPlans(grok, planDefinitions[grok.id]);
  assert.ok(grokPlans.length > 0, "Grok has no public purchase items");
  assert.equal(
    (grokHtml.match(/<button[^>]*class="plan-chip/g) ?? []).length,
    grokPlans.length,
  );

  const iCloudHtml = await readPage("/apps/apple-icloud-plus/index.html");
  assert.match(iCloudHtml, /iCloud\+ 50 GB/);
  assert.match(iCloudHtml, /iCloud\+ 12 TB/);
  assert.match(iCloudHtml, /20\/20 地区/);

  const oneHtml = await readPage("/apps/apple-one/index.html");
  assert.match(oneHtml, /Apple One 个人方案/);
  assert.match(oneHtml, /Apple One Premier/);

  const arcadeHtml = await readPage("/apps/apple-arcade/index.html");
  assert.match(arcadeHtml, /Apple Arcade/);
  assert.match(arcadeHtml, /年付/);

  const fitnessHtml = await readPage("/apps/apple-fitness-plus/index.html");
  assert.match(fitnessHtml, /Apple Fitness\+/);
  assert.match(fitnessHtml, /地区有价格/);

  const tvHtml = await readPage("/apps/apple-tv-plus/index.html");
  assert.match(tvHtml, /Apple TV\+/);
  const newsHtml = await readPage("/apps/apple-news-plus/index.html");
  assert.match(newsHtml, /Apple News\+/);

  const serviceIcons = {
    "apple-icloud-plus": "/service-icons/apple-icloud-plus.png",
    "apple-one": "/service-icons/apple-one.png",
    "apple-tv-plus": "/service-icons/apple-tv-plus.webp",
    "apple-arcade": "/service-icons/apple-arcade.webp",
    "apple-fitness-plus": "/service-icons/apple-fitness-plus.webp",
    "apple-news-plus": "/service-icons/apple-news-plus.webp",
  };
  for (const [id, icon] of Object.entries(serviceIcons)) {
    assert.equal(snapshot.apps.find((app) => app.id === id)?.icon, icon);
    await stat(new URL(`../public${icon}`, import.meta.url));
  }
});

test("uses one comparison view and keeps sharing focused", async () => {
  const priceExplorerSource = await readFile(
    new URL("../app/components/PriceExplorer.tsx", import.meta.url),
    "utf8",
  );
  const curatedDetailSource = await readFile(
    new URL("../app/apps/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const customSearchSource = await readFile(
    new URL("../app/components/CustomAppSearch.tsx", import.meta.url),
    "utf8",
  );

  assert.match(priceExplorerSource, /分享图片/);
  assert.match(priceExplorerSource, /复制链接/);
  assert.match(priceExplorerSource, /quickchart\.io\/qr/);
  assert.match(priceExplorerSource, /clientKind === "wechat"/);
  assert.match(priceExplorerSource, /请在浏览器中打开/);
  assert.doesNotMatch(
    priceExplorerSource,
    /系统分享|扫码查看完整地区价格|当前设备不直接切换 App Store|已识别为 iPhone/,
  );
  assert.match(curatedDetailSource, /AppComparisonView/);
  assert.match(customSearchSource, /AppComparisonView/);
  assert.match(customSearchSource, /searchParams\.set\("app", appId\)/);
  assert.match(customSearchSource, /searchParams\.get\("app"\)/);
  assert.match(customSearchSource, /searchParams\.delete\("app"\)/);
});

test("exports a public log for confirmed price changes", async () => {
  const html = await readPage("/changes/index.html");
  const changeLog = JSON.parse(await readFile(new URL("../data/price-change-log.json", import.meta.url), "utf8"));
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  const entries = changeLog.entries.filter((entry) => entry.changes.length > 0);
  assert.match(html, /订阅变动日志/);
  assert.match(html, /套餐与价格的每一次变化/);
  assert.match(html, /套餐调价、新增、移除，以及应用、地区与可用状态变化/);
  assert.match(html, /新增套餐/);
  assert.match(html, /移除套餐/);
  assert.match(html, /应用、地区与状态变化/);
  assert.doesNotMatch(html, /Bark/i);
  if (entries.length) {
    assert.doesNotMatch(html, /暂时还没有已发布的价格变动/);
    assert.match(html, /<details class="change-entry" open="">/);
    assert.match(html, /查看详情/);
    assert.match(html, /收起详情/);
    assert.ok(html.includes(`${entries[0].changeCount} 个应用或地区有变化`));
    assert.ok(html.includes(escapeHtmlText(entries[0].changes[0].appName)));
    const currentChange = entries.flatMap((entry) => entry.changes)
      .find((change) => snapshot.apps.some((app) => app.id === change.appId));
    if (currentChange) assert.ok(html.includes(`/apps/${currentChange.appId}/`));
  } else {
    assert.match(html, /暂时还没有已发布的价格变动/);
  }
  assert.doesNotMatch(html, /状态变化也会被单独记录/);
  assert.doesNotMatch(html, /代表不同情况。系统不会猜测国家页面/);
});

test("exports installable app metadata and home-screen icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../out/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "App Store 订阅比价");
  assert.equal(manifest.short_name, "订阅比价");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#f5f5f7");
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/app-icon-192.png"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/app-icon-512.png" && icon.purpose === "maskable"));
  await stat(new URL("../out/apple-icon.png", import.meta.url));
  await stat(new URL("../out/icons/app-icon-192.png", import.meta.url));
  await stat(new URL("../out/icons/app-icon-512.png", import.meta.url));
});

test("keeps gift-card and recharge guidance out of the published site", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  const pages = ["/index.html", "/changes/index.html", ...snapshot.apps.map((app) => `/apps/${app.id}/index.html`)];
  for (const page of pages) {
    const html = await readPage(page);
    assert.doesNotMatch(html, /礼品卡|充值渠道|SEAGM|gift\s*card/iu, page);
  }
});

test("exports crawler discovery files for the public site", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  const robots = await readFile(new URL("../out/robots.txt", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../out/sitemap.xml", import.meta.url), "utf8");
  const llms = await readFile(new URL("../out/llms.txt", import.meta.url), "utf8");

  assert.match(robots, /Allow: \/(?:\r?\n|$)/);
  assert.match(robots, /User-Agent: OAI-SearchBot[\s\S]*?Allow: \//);
  assert.match(robots, /User-Agent: ChatGPT-User[\s\S]*?Allow: \//);
  assert.match(robots, /Sitemap: https:\/\/price\.290935\.xyz\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/price\.290935\.xyz<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/price\.290935\.xyz\/changes\/<\/loc>/);
  assert.match(llms, /^# App Store 订阅比价/m);
  assert.match(llms, /服务不可用、官方价格未公开与解析失败是三种不同状态/);
  for (const app of snapshot.apps) {
    assert.match(sitemap, new RegExp(`<loc>https://price\\.290935\\.xyz/apps/${app.id}/</loc>`));
    assert.match(llms, new RegExp(`https://price\\.290935\\.xyz/apps/${app.id}/`));
  }
});

test("exports machine-readable structured data", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  const home = await readPage("/index.html");
  const detail = await readPage("/apps/6448311069/index.html");
  const parseJsonLd = (html) =>
    [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((match) => JSON.parse(match[1]));

  const homeJsonLd = parseJsonLd(home);
  const detailJsonLd = parseJsonLd(detail);

  assert.ok(homeJsonLd.some((entry) => entry["@type"] === "WebSite"));
  assert.ok(homeJsonLd.some((entry) => entry["@type"] === "ItemList" && entry.numberOfItems === snapshot.apps.length));
  assert.ok(detailJsonLd.some((entry) => entry["@type"] === "BreadcrumbList"));
  assert.ok(detailJsonLd.some((entry) =>
    entry["@type"] === "SoftwareApplication"
    && entry.name === "ChatGPT"
    && entry.additionalProperty.some((property) => property.name === "比价地区数量" && property.value === 20)
  ));
  assert.match(detail, /<meta property="og:url" content="https:\/\/price\.290935\.xyz\/apps\/6448311069\/"/);

  const appleService = parseJsonLd(await readPage("/apps/apple-icloud-plus/index.html"));
  assert.ok(appleService.some((entry) => entry["@type"] === "Service" && entry.name === "iCloud+"));
});
