import { BrandMark } from "./BrandMark";
import { SiteShareButton } from "./SiteShareButton";
import { dataUpdatedAt, rateAttributionUrl, rateProvider } from "../lib/catalog";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="brand footer-brand">
        <BrandMark />
        <span><strong>App Store</strong><small>全球价格</small></span>
      </div>
      <div className="footer-copy">
        <p>价格快照 {dataUpdatedAt} · 汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</p>
        <p>价格、购买资格和税费以对应地区 Apple 结算页为准。</p>
        <SiteShareButton />
        <p className="footer-copyright">© {new Date().getFullYear()} App Store 全球价格 · 本站与 Apple Inc. 无隶属关系</p>
      </div>
    </footer>
  );
}
