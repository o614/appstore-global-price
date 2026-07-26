import type { Metadata, Viewport } from "next";
import { SafariShell } from "./components/SafariShell";
import "./globals.css";
import "./apple-design.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
const title = "App Store 全球价格";
const description = "比较热门 App 与 Apple 订阅服务在 20 个地区的官方价格，按月付、年付和一次性购买分别查看。";
const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,
  url: siteUrl,
  name: title,
  description,
  inLanguage: "zh-CN",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: title,
  title,
  description,
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "全球价格",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "zh_CN",
    siteName: title,
    url: siteUrl,
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: title }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-v2.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#f5f5f7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }}
        />
        <SafariShell />
        {children}
      </body>
    </html>
  );
}
