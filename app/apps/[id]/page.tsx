import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertLine,
  ArrowDownLine,
  ArrowLeftLine,
  CheckCircleLine,
  Earth2Line,
  ListCheckLine,
  Numbers09SortAscendingLine,
} from "@mingcute/react";
import { AppArtwork } from "../../components/AppArtwork";
import { BrandMark } from "../../components/BrandMark";
import { DataFreshness } from "../../components/DataFreshness";
import { PriceExplorer } from "../../components/PriceExplorer";
import {
  apps,
  dataGeneratedAt,
  dataUpdatedAt,
  getApp,
  getAppCoverage,
  getPriceSourceCopy,
  getPlansForApp,
  getVerifiedRegionCount,
  rateAttributionUrl,
  rateProvider,
  rateUpdatedAt,
} from "../../lib/catalog";

export const dynamicParams = false;

export function generateStaticParams() {
  return apps.map((app) => ({ id: app.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const app = getApp(id);
  if (!app) return {};
  const priceKind = app.priceSource === "app-store" || !app.priceSource ? "App Store 内购" : "Apple 官方订阅";
  return {
    title: `${app.matchedName} 全球价格｜App Store 全球价格`,
    description: `查看 ${app.matchedName} 在多个地区的公开${priceKind}价格。`,
    alternates: { canonical: `/apps/${app.id}/` },
  };
}

export default async function AppPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApp(id);
  if (!app) notFound();
  const plans = getPlansForApp(app);
  const verifiedCount = getVerifiedRegionCount(app);
  const coverage = getAppCoverage(app);
  const sourceCopy = getPriceSourceCopy(app);

  return (
    <main className="detail-page">
      <header className="site-header detail-header">
        <Link className="brand" href="/"><BrandMark /><span><strong>App Store</strong><small>全球价格</small></span></Link>
        <Link className="back-link" href="/#apps"><ArrowLeftLine className="ui-icon" aria-hidden="true" />返回应用目录</Link>
      </header>

      <section className="app-hero">
        <AppArtwork app={app} alt={`${app.matchedName} 图标`} className="app-hero-icon" size={104} priority />
        <div className="app-hero-copy">
          <div className="app-title-row"><h1>{app.matchedName}</h1><span>{app.category}</span></div>
          <p>{app.developer}</p>
          <div className="detail-badges">
            <span className="detail-meta-badge detail-id-badge"><Numbers09SortAscendingLine className="ui-icon" aria-hidden="true" />{app.priceSource === "app-store" || !app.priceSource ? "App ID" : "服务 ID"} <b>{app.id}</b></span>
            <span className="detail-meta-badge"><Earth2Line className="ui-icon" aria-hidden="true" />{verifiedCount}/{app.regions.length} 地区</span>
            {plans.length > 0 && <span className="detail-meta-badge"><ListCheckLine className="ui-icon" aria-hidden="true" />{plans.length} 个套餐</span>}
            {coverage.review > 0 && <span className="detail-meta-badge review-badge"><AlertLine className="ui-icon" aria-hidden="true" />{coverage.review} 地区待复核</span>}
            <DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} />
          </div>
        </div>
        <a className="store-button" href="#comparison">选择地区打开 <ArrowDownLine className="ui-icon" aria-hidden="true" /></a>
      </section>

      <section className="comparison-section" id="comparison">
        <div className="section-heading detail-section-heading">
          <div><span className="eyebrow">全球价格</span><h2>选择套餐，查看各地区价格</h2></div>
          <span className="truth-note"><CheckCircleLine className="ui-icon" aria-hidden="true" />同套餐、同周期比较</span>
        </div>
        <PriceExplorer app={app} plans={plans} />
      </section>

      <section className="detail-notes">
        <article><span>Apple 标价</span><p>原币金额来自对应地区的{sourceCopy.noun}。</p></article>
        <article><span>人民币参考</span><p>按 {new Date(rateUpdatedAt).toLocaleDateString("zh-CN")} 日汇率折算，由 <a href={rateAttributionUrl}>{rateProvider}</a> 提供。</p></article>
        <article><span>套餐比较</span><p>月付、年付和一次性购买分别排名；缺少该套餐的地区不参与比较。</p></article>
      </section>
    </main>
  );
}
