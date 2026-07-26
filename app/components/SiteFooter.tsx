import { BrandMark } from "./BrandMark";
import { DataFreshness } from "./DataFreshness";
import { SiteShareButton } from "./SiteShareButton";
import { dataGeneratedAt, dataUpdatedAt, rateAttributionUrl, rateProvider } from "../lib/catalog";
import { publicSiteLinks, publicStatusPageUrl } from "../lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-intro">
          <div className="brand footer-brand">
            <BrandMark />
            <span><strong>App Store</strong><small>全球价格</small></span>
          </div>
          <p>查看同一应用或订阅服务在不同地区的 Apple 官方价格。</p>
        </div>

        <div className="footer-links">
          <section>
            <h2>文章教程</h2>
            <a href={publicSiteLinks.registerTutorial} target="_blank" rel="noreferrer">注册教程</a>
            <a href={publicSiteLinks.regionTutorial} target="_blank" rel="noreferrer">改区教程</a>
            <a href={publicSiteLinks.rechargeTutorial} target="_blank" rel="noreferrer">充值教程</a>
            <a href={publicSiteLinks.moreTutorials} target="_blank" rel="noreferrer">更多教程</a>
          </section>

          <section>
            <h2>联系作者</h2>
            <a href={publicSiteLinks.officialAccount} target="_blank" rel="noreferrer">公众号</a>
          </section>
        </div>
      </div>

      <div className="footer-bottom">
        <p className="footer-data-status"><DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} variant="inline" /> · 汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</p>
        <p>价格、购买资格和税费以对应地区 Apple 结算页为准。</p>
        <div className="footer-utility-actions">
          <a className="footer-status-link" href={publicStatusPageUrl} target="_blank" rel="noreferrer">
            <span className="footer-status-indicator" aria-hidden="true" />
            系统状态
          </a>
          <SiteShareButton />
        </div>
        <p className="footer-copyright">© {new Date().getFullYear()} App Store 全球价格 · 本站与 Apple Inc. 无隶属关系</p>
      </div>
    </footer>
  );
}
