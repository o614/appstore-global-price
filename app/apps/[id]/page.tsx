import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppComparisonView } from "../../components/AppComparisonView";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import {
  apps,
  formatDataUpdatedAt,
  getApp,
  getAppGeneratedAt,
  getPlansForApp,
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
  const title = `${app.matchedName} 订阅比价｜App Store 订阅比价`;
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
      images: app.icon ? [{ url: app.icon, alt: `${app.matchedName} 图标` }] : ["/og-v2.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: app.icon ? [app.icon] : ["/og-v2.jpg"],
    },
  };
}

export default async function AppPricePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApp(id);
  if (!app) notFound();
  const plans = getPlansForApp(app);
  const appGeneratedAt = getAppGeneratedAt(app);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
  const pageUrl = `${siteUrl}/apps/${app.id}/`;
  const isAppleService = app.priceSource === "apple-service" || app.priceSource === "apple-music";
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
        item: pageUrl,
      },
    ],
  };
  const entityJsonLd = isAppleService
    ? {
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": `${pageUrl}#service`,
        name: app.matchedName,
        description: `${app.matchedName} 在固定 ${app.regions.length} 个地区的 Apple 官方订阅价格比较。`,
        url: pageUrl,
        image: app.icon ? new URL(app.icon, siteUrl).href : undefined,
        sameAs: app.storeUrl,
        serviceType: "Apple 订阅服务",
        provider: { "@type": "Organization", name: app.developer || "Apple Inc." },
        additionalProperty: [
          { "@type": "PropertyValue", name: "比价地区数量", value: app.regions.length },
          { "@type": "PropertyValue", name: "公开购买项目数量", value: plans.length },
        ],
      }
    : {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": `${pageUrl}#application`,
        name: app.matchedName,
        description: `${app.matchedName} 在固定 ${app.regions.length} 个地区的 App Store 公开订阅价格比较。`,
        url: pageUrl,
        image: app.icon ? new URL(app.icon, siteUrl).href : undefined,
        sameAs: app.storeUrl,
        applicationCategory: app.category || "MobileApplication",
        operatingSystem: "iOS, iPadOS",
        author: { "@type": "Organization", name: app.developer },
        additionalProperty: [
          { "@type": "PropertyValue", name: "比价地区数量", value: app.regions.length },
          { "@type": "PropertyValue", name: "公开购买项目数量", value: plans.length },
        ],
      };

  return (
    <main className="detail-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(entityJsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      <AppComparisonView
        app={app}
        plans={plans}
        generatedAt={appGeneratedAt}
        displayDate={formatDataUpdatedAt(appGeneratedAt)}
        priority
      />
      <SiteFooter />
    </main>
  );
}
