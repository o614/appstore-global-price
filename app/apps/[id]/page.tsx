import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertLine,
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
import { PriceShareProvider } from "../../components/PriceShareContext";
import { PriceShareTrigger } from "../../components/PriceShareTrigger";
import { SiteFooter } from "../../components/SiteFooter";
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
  const title = `${app.matchedName} 全球价格｜App Store 全球价格`;
  const description = `查看 ${app.matchedName} 在多个地区的公开${priceKind}价格。`;
  const pageUrl = `/apps/${app.id}/`;
  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      type: "website",
      url: pageUrl,
      images: app.icon ? [{ url: app.icon, alt: `${app.matchedName} 图标` }] : ["/og-v2.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: app.icon ? [app.icon] : ["/og-v2.png"],
    },
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "应用目录",
        item: `${siteUrl}/#apps`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: app.matchedName,
        item: `${siteUrl}/apps/${app.id}/`,
      },
    ],
  };

  return (
    <main className="detail-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="site-header detail-header">
        <Link className="brand" href="/"><BrandMark /><span><strong>App Store</strong><small>全球价格</small></span></Link>
        <Link className="back-link" href="/#apps"><ArrowLeftLine className="ui-icon" aria-hidden="true" />返回应用目录</Link>
      </header>

      <PriceShareProvider>
        <section className="app-hero">
          <AppArtwork app={app} alt={`${app.matchedName} 图标`} className="app-hero-icon" size={104} priority />
          <div className="app-hero-copy">
            <div className="app-title-row"><h1>{app.matchedName}</h1><span>{app.category}</span></div>
            <p>{app.developer}</p>
            <div className="detail-badges">
              <span className="detail-meta-badge detail-id-badge"><Numbers09SortAscendingLine className="ui-icon" aria-hidden="true" />{app.priceSource === "app-store" || !app.priceSource ? "App ID" : "服务 ID"} <b>{app.id}</b></span>
              <span className="detail-meta-badge"><Earth2Line className="ui-icon" aria-hidden="true" />{verifiedCount}/{app.regions.length} 地区有价格</span>
              {plans.length > 0 && <span className="detail-meta-badge"><ListCheckLine className="ui-icon" aria-hidden="true" />{plans.length} 个公开套餐</span>}
              {coverage.review > 0 && <span className="detail-meta-badge review-badge"><AlertLine className="ui-icon" aria-hidden="true" />{coverage.review} 地区待复核</span>}
              <DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} />
            </div>
          </div>
          <PriceShareTrigger disabled={plans.length === 0} />
        </section>

        <section className="comparison-section" id="comparison">
          <div className="section-heading detail-section-heading">
            <div><span className="eyebrow">全球价格</span><h2>选择套餐，查看各地区价格</h2></div>
            <span className="truth-note"><CheckCircleLine className="ui-icon" aria-hidden="true" />同套餐、同周期比较</span>
          </div>
          <PriceExplorer app={app} plans={plans} />
        </section>
      </PriceShareProvider>

      <section className="detail-notes">
        <article><span>Apple 标价</span><p>原币金额来自对应地区的{sourceCopy.noun}。</p></article>
        <article><span>人民币参考</span><p>按公开汇率折算，由 <a href={rateAttributionUrl}>{rateProvider}</a> 提供。</p></article>
        <article><span>套餐比较</span><p>月付、年付和一次性购买分别排名；缺少该套餐的地区不参与比较。</p></article>
      </section>
      <SiteFooter />
    </main>
  );
}
