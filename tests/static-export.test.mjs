import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function readPage(path) {
  const html = await readFile(new URL(`../out${path}`, import.meta.url), "utf8");
  return html.replaceAll("<!-- -->", "");
}

test("exports the price comparison homepage as static HTML", async () => {
  const html = await readPage("/index.html");
  assert.match(html, /<title>App Store 全球价格<\/title>/);
  assert.match(html, /先看清价格/);
  assert.match(html, /ChatGPT Plus/);
  assert.match(html, /应用与订阅服务/);
  assert.match(html, /浏览应用/);
  assert.match(html, /覆盖 17 个应用与服务、20 个地区/);
  assert.match(html, /未上架或未公开价格的地区不参与排名/);
  assert.match(html, /<strong>20<\/strong><span>比价地区<\/span>/);
  assert.match(html, /© 2026 App Store 全球价格/);
  assert.match(html, /比较热门 App 与 Apple 订阅服务在 20 个地区的官方价格/);
  assert.doesNotMatch(html, /组地区价格已验证/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("exports every configured app detail route", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/validation-snapshot.json", import.meta.url), "utf8"));
  for (const app of snapshot.apps) {
    await stat(new URL(`../out/apps/${app.id}/index.html`, import.meta.url));
  }

  const html = await readPage("/apps/6448311069/index.html");
  assert.match(html, /ChatGPT 全球价格/);
  assert.match(html, /App ID/);
  assert.match(html, /6448311069/);
  assert.match(html, /选择套餐，查看各地区价格/);
  assert.match(html, /同套餐、同周期比较/);
  assert.match(html, /分享比价/);
  assert.match(html, /查看跳转方式/);

  const netflixHtml = await readPage("/apps/363590051/index.html");
  const netflix = snapshot.apps.find((app) => app.id === "363590051");
  assert.ok(netflix, "Netflix is missing from the snapshot");
  assert.ok(netflix.regions.some((region) => region.itemCount > 0), "Netflix has no public regional prices");
  assert.match(netflixHtml, /Netflix/);
  assert.match(netflixHtml, /363590051/);

  const claudeHtml = await readPage("/apps/6473753684/index.html");
  assert.match(claudeHtml, /Claude Usage Credits 20/);
  assert.match(claudeHtml, /Claude Usage Credits 50/);
  assert.match(claudeHtml, /Claude Usage Credits 250/);

  const appleMusicHtml = await readPage("/apps/1108187390/index.html");
  assert.match(appleMusicHtml, /Apple Music 个人方案/);
  assert.match(appleMusicHtml, /Apple Music 家庭方案/);
  assert.match(appleMusicHtml, /Apple Music 学生方案/);
  assert.match(appleMusicHtml, /查看官方方案/);

  const grokHtml = await readPage("/apps/6670324846/index.html");
  assert.match(grokHtml, /Extra Usage Credits 10 USD/);
  assert.match(grokHtml, /Extra Usage Credits 100 USD/);
  assert.equal((grokHtml.match(/<button[^>]*class="plan-chip/g) ?? []).length, 10);

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
  assert.match(fitnessHtml, /NT\$1,190/);

  const tvHtml = await readPage("/apps/apple-tv-plus/index.html");
  assert.match(tvHtml, /Apple TV\+/);
  const newsHtml = await readPage("/apps/apple-news-plus/index.html");
  assert.match(newsHtml, /Apple News\+/);

  const serviceIcons = {
    "apple-icloud-plus": "/service-icons/apple-icloud-plus.png",
    "apple-one": "/service-icons/apple-one.png",
    "apple-tv-plus": "/service-icons/apple-tv-plus.png",
    "apple-arcade": "/service-icons/apple-arcade.png",
    "apple-fitness-plus": "/service-icons/apple-fitness-plus.png",
    "apple-news-plus": "/service-icons/apple-news-plus.png",
  };
  for (const [id, icon] of Object.entries(serviceIcons)) {
    assert.equal(snapshot.apps.find((app) => app.id === id)?.icon, icon);
    await stat(new URL(`../public${icon}`, import.meta.url));
  }
});

test("exports a public log for confirmed price changes", async () => {
  const html = await readPage("/changes/index.html");
  assert.match(html, /价格变动日志/);
  assert.match(html, /每一次价格变化/);
  assert.match(html, /已经验证并发布的价格变化/);
  assert.doesNotMatch(html, /Bark/i);
  assert.match(html, /暂时还没有已发布的价格变动/);
  assert.match(html, /服务不可用/);
  assert.match(html, /官方价格未公开/);
  assert.match(html, /解析失败/);
});

test("exports installable app metadata and home-screen icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../out/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "App Store 全球价格");
  assert.equal(manifest.short_name, "全球价格");
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

  assert.match(robots, /Allow: \/(?:\r?\n|$)/);
  assert.match(robots, /Sitemap: https:\/\/price\.290935\.xyz\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/price\.290935\.xyz<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/price\.290935\.xyz\/changes\/<\/loc>/);
  for (const app of snapshot.apps) {
    assert.match(sitemap, new RegExp(`<loc>https://price\\.290935\\.xyz/apps/${app.id}/</loc>`));
  }
});
