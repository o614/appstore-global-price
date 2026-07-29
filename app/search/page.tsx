import type { Metadata } from "next";
import { CustomAppSearch } from "../components/CustomAppSearch";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";

export const metadata: Metadata = {
  title: "应用搜索｜App Store 订阅比价",
  description: "输入应用名称、App ID 或 App Store 链接，查看公开内购价格。",
  alternates: { canonical: "/search/" },
};

export default function SearchPage() {
  return (
    <main className="custom-search-page">
      <SiteHeader active="search" />

      <section className="custom-search-hero">
        <span className="eyebrow">应用搜索</span>
        <h1>查找 App，<br />比较订阅价格。</h1>
        <p>输入应用名称、App ID 或 App Store 链接。</p>
      </section>

      <CustomAppSearch />
      <SiteFooter />
    </main>
  );
}
