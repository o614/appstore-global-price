import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PriceExplorer } from "../../components/PriceExplorer";
import {
  apps,
  dataUpdatedAt,
  getApp,
  getVerifiedRegionCount,
  planDefinitions,
  rateAttributionUrl,
  rateProvider,
  rateUpdatedAt,
} from "../../lib/catalog";

export function generateStaticParams() {
  return apps.map((app) => ({ id: app.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const app = getApp(id);
  if (!app) return {};
  return {
    title: `${app.matchedName} 全球内购价格｜App Store 全球价格`,
    description: `查看 ${app.matchedName} 在多个 App Store 地区的公开内购与订阅价格。`,
  };
}

export default async function AppPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApp(id);
  if (!app) notFound();
  const plans = planDefinitions[id] ?? [];
  const verifiedCount = getVerifiedRegionCount(app);

  return (
    <main className="detail-page">
      <header className="site-header detail-header">
        <a className="brand" href="/"><span className="brand-mark">AP</span><span><strong>App Store</strong><small>全球价格</small></span></a>
        <a className="back-link" href="/#apps">← 返回应用目录</a>
      </header>

      <section className="app-hero">
        <img src={app.icon} alt={`${app.matchedName} 图标`} className="app-hero-icon" />
        <div className="app-hero-copy">
          <div className="app-title-row"><h1>{app.matchedName}</h1><span>{app.category}</span></div>
          <p>{app.developer}</p>
          <div className="detail-badges">
            <span>App ID {app.id}</span>
            <span>{verifiedCount}/10 地区已验证</span>
            <span>数据 {dataUpdatedAt}</span>
          </div>
        </div>
        <a className="store-button" href={app.storeUrl} target="_blank" rel="noreferrer">打开 App Store ↗</a>
      </section>

      <section className="comparison-section">
        <div className="section-heading detail-section-heading">
          <div><span className="eyebrow">全球公开价格</span><h2>选择一个套餐进行比较</h2></div>
          <span className="truth-note"><i /> 仅对已确认的同一套餐排名</span>
        </div>
        <PriceExplorer app={app} plans={plans} />
      </section>

      <section className="detail-notes">
        <article><span>Apple 标价</span><p>原币金额来自对应地区 Apple 商品页的当前公开内容。</p></article>
        <article><span>人民币参考</span><p>按 {new Date(rateUpdatedAt).toLocaleDateString("zh-CN")} 日汇率折算，由 <a href={rateAttributionUrl}>{rateProvider}</a> 提供。</p></article>
        <article><span>购买提醒</span><p>地区账户、付款方式、税费和优惠资格可能影响最终结算。</p></article>
      </section>
    </main>
  );
}
