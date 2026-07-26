import Image from "next/image";
import Link from "next/link";
import { ArrowRightLine, ExternalLinkLine } from "@mingcute/react";
import { AppDirectory } from "./components/AppDirectory";
import { BrandMark } from "./components/BrandMark";
import { DataFreshness } from "./components/DataFreshness";
import { RegionFlag } from "./components/RegionFlag";
import { SiteFooter } from "./components/SiteFooter";
import {
  apps,
  dataGeneratedAt,
  dataUpdatedAt,
  findPlanItem,
  getAppCoverage,
  getPlansForApp,
  getRegionStoreUrl,
  getVerifiedRegionCount,
  regionMeta,
  toCny,
} from "./lib/catalog";

const cardApps = apps.map((app) => ({
  ...app,
  coverage: getAppCoverage(app),
  verifiedCount: getVerifiedRegionCount(app),
  planCount: getPlansForApp(app).length,
}));
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
const appDirectoryJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "App Store 应用与订阅服务全球价格目录",
  numberOfItems: apps.length,
  itemListElement: apps.map((app, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: app.matchedName,
    url: `${siteUrl}/apps/${app.id}/`,
  })),
};

export default function Home() {
  const chatgpt = cardApps.find((app) => app.id === "6448311069")!;
  const featuredPlan = getPlansForApp(chatgpt).find((plan) => plan.id === "plus-monthly");
  const featuredRows = featuredPlan
    ? chatgpt.regions
        .map((region) => {
          const item = findPlanItem(region, featuredPlan);
          return { region, item, cny: item ? toCny(item.price, region.region) : null };
        })
        .filter((row) => row.item && row.cny !== null)
        .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity))
    : [];
  const featuredLowest = featuredRows[0];
  const verifiedStorePages = cardApps.reduce((total, app) => total + app.verifiedCount, 0);
  const regionCount = Object.keys(regionMeta).length;

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appDirectoryJsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="site-header">
        <Link className="brand" href="/" aria-label="App Store 全球价格首页">
          <BrandMark />
          <span><strong>App Store</strong><small>全球价格</small></span>
        </Link>
        <nav>
          <a href="#apps">应用目录</a>
          <a href="#method">数据说明</a>
          <Link href="/changes/">价格日志</Link>
          <DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} />
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">GLOBAL IN-APP PRICE INDEX</span>
          <h1>先看清价格，<br />再决定在哪个区买。</h1>
          <p>比较同一 App 或订阅服务在不同地区的 Apple 官方价格。保留原币标价，人民币金额仅供参考。</p>
          <div className="hero-actions">
            <a href="#apps" className="primary-button">浏览应用 <ArrowRightLine className="ui-icon" aria-hidden="true" /></a>
            <Link href="/apps/6448311069" className="secondary-button">查看 ChatGPT 示例</Link>
          </div>
          <div className="hero-stats">
            <div><strong>{apps.length}</strong><span>应用与服务</span></div>
            <div><strong>{regionCount}</strong><span>比价地区</span></div>
            <div><strong>{verifiedStorePages}</strong><span>已验证价格页</span></div>
          </div>
        </div>

        <article className="hero-price-card">
          <div className="featured-app">
            <Image src={chatgpt.icon ?? "/og.png"} alt="" width={58} height={58} priority />
            <div><span>热门对比</span><h2>ChatGPT Plus</h2><p>月付套餐 · {regionCount} 个地区</p></div>
            <Link href={`/apps/${chatgpt.id}`} aria-label="查看 ChatGPT 详细比价"><ExternalLinkLine className="ui-icon" aria-hidden="true" /></Link>
          </div>
          <div className="price-spotlight">
            <span>参考折算最低</span>
            <strong>{featuredLowest ? regionMeta[featuredLowest.region.region].name : "暂无完整数据"}</strong>
            <div><b>{featuredLowest?.item?.price ?? "—"}</b><em>{featuredLowest?.cny ? `约 ¥${featuredLowest.cny.toFixed(2)}` : "等待验证"}</em></div>
          </div>
          <div className="mini-regions">
            {featuredRows.slice(0, 3).map((row) => {
              const meta = regionMeta[row.region.region];
              return <a href={getRegionStoreUrl(chatgpt.id, row.region.region)} target="_blank" rel="noreferrer" key={row.region.region}><span><RegionFlag code={row.region.region} name={meta.name} />{meta.name}</span><b>¥{row.cny?.toFixed(2)}</b></a>;
            })}
          </div>
          <Link className="card-detail-link" href={`/apps/${chatgpt.id}`}>查看月付、年付和地区套餐差异 <ArrowRightLine className="ui-icon" aria-hidden="true" /></Link>
        </article>
      </section>

      <section className="coverage-note" aria-labelledby="coverage-note-title">
        <div>
          <span className="eyebrow">比较范围</span>
          <strong id="coverage-note-title">覆盖 {apps.length} 个应用与服务、{regionCount} 个地区</strong>
        </div>
        <p>仅展示 Apple 已公开的价格；未上架或未公开价格的地区不参与排名。人民币金额仅供参考。</p>
      </section>

      <AppDirectory apps={cardApps} />

      <section className="method-section" id="method">
        <div className="method-copy">
          <span className="eyebrow">数据说明</span>
          <h2>不同周期分开比较，价格来源清晰可查。</h2>
          <p>月付、年付和一次性购买分别比较；无法确认的项目不参与排名。</p>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>确认同一应用</h3><p>各地区统一使用同一 App ID，避免同名应用混淆。</p></article>
          <article><span>02</span><h3>保留官方原币</h3><p>人民币金额按公开汇率折算，仅用于横向比较。</p></article>
          <article><span>03</span><h3>确认更新时间</h3><p>每日自动检测 4 次；通过校验并发布后，页面快照时间与 <Link href="/changes/">价格日志</Link> 同步更新。</p></article>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
