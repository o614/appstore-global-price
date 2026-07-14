import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";
const title = "App Store 全球价格";
const description = "区分月付与年付，查看不同地区真实公开套餐数量和 Apple 原币标价。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
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
