import Image from "next/image";
import Link from "next/link";
import { ArrowRightLine, ExternalLinkLine } from "@mingcute/react";
import { AppDirectory } from "./components/AppDirectory";
import { RegionFlag } from "./components/RegionFlag";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import {
  apps,
  findPlanItem,
  getAppCoverage,
  getPlansForApp,
  getRegionStoreUrl,
  regionMeta,
  toCny,
} from "./lib/catalog";
import { comparisonRegionCount } from "./lib/region-config";

const cardApps = apps.map((app) => ({
  ...app,
  coverage: getAppCoverage(app),
  planCount: getPlansForApp(app).length,
}));
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
const appDirectoryJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "App Store 应用与订阅服务价格目录",
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
  const regionCount = Object.keys(regionMeta).length;

  return (
    <main className="home-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appDirectoryJsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader active="apps" />

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">APP STORE SUBSCRIPTION PRICES</span>
            <h1>先看清价格，再决定在哪个区买。</h1>
            <p>比较同一 App 或订阅服务在不同地区的 Apple 官方价格。保留原币标价，人民币金额仅供参考。</p>
            <div className="hero-actions">
              <a href="#apps" className="primary-button">浏览应用</a>
            </div>
          </div>

          <article className="hero-price-card">
            <div className="featured-app">
              <Image src={chatgpt.icon ?? "/icon.svg"} alt="" width={58} height={58} priority />
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
            <Link className="card-detail-link" href={`/apps/${chatgpt.id}`}>查看完整地区排名 <ArrowRightLine className="ui-icon" aria-hidden="true" /></Link>
          </article>
        </div>
      </section>

      <AppDirectory apps={cardApps} regionCount={regionCount} />

      <section className="coverage-note" aria-label="地区选择说明">
        <div>
          <span className="eyebrow">比较范围</span>
          <strong>为什么固定这 {comparisonRegionCount} 个地区</strong>
        </div>
        <p>覆盖常用 Apple ID 地区、主要币种与价格差异明显的市场；找出低价不是目的，能够优惠订阅才是王道。</p>
      </section>

      <SiteFooter />
    </main>
  );
}
