import Link from "next/link";
import { dataGeneratedAt, dataUpdatedAt } from "../lib/catalog";
import { BrandMark } from "./BrandMark";
import { DataFreshness } from "./DataFreshness";

type SiteHeaderProps = {
  active?: "apps" | "search" | "changes";
};

export function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="App Store 订阅比价首页">
        <BrandMark />
        <span><strong>App Store</strong><small>订阅比价</small></span>
      </Link>
      <nav aria-label="主导航">
        <Link href="/#apps" aria-current={active === "apps" ? "page" : undefined}>应用目录</Link>
        <Link href="/search/" aria-current={active === "search" ? "page" : undefined}>搜索应用</Link>
        <Link href="/changes/" aria-current={active === "changes" ? "page" : undefined}>订阅变动</Link>
        <DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} />
      </nav>
    </header>
  );
}
