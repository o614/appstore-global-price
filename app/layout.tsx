import type { Metadata } from "next";
import "./globals.css";
import "./apple-design.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
const title = "App Store 全球价格";
const description = "比较同一 App 或订阅服务在 20 个地区的 Apple 官方标价，区分月付、年付与一次性购买。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: title }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-v2.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
