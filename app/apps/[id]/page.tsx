import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppComparisonView } from "../../components/AppComparisonView";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import {
  apps,
  dataGeneratedAt,
  dataUpdatedAt,
  getApp,
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
      <SiteHeader />
      <AppComparisonView
        app={app}
        plans={plans}
        generatedAt={dataGeneratedAt}
        displayDate={dataUpdatedAt}
        priority
      />
      <SiteFooter />
    </main>
  );
}
