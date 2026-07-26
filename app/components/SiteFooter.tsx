import { BrandMark } from "./BrandMark";
import { DataFreshness } from "./DataFreshness";
import { SiteShareButton } from "./SiteShareButton";
import { dataGeneratedAt, dataUpdatedAt, rateAttributionUrl, rateProvider } from "../lib/catalog";
import { publicContact, publicSiteLinks, publicStatusPageUrl } from "../lib/site";

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
            <h2>网站</h2>
            <a href={publicSiteLinks.blog} target="_blank" rel="noreferrer">博客 · 290935.xyz</a>
            <a className="footer-status-link" href={publicStatusPageUrl} target="_blank" rel="noreferrer">
              <span className="footer-status-indicator" aria-hidden="true" />
              系统状态
            </a>
            <SiteShareButton />
          </section>

          <section>
            <h2>联系我们</h2>
            <span>公众号：{publicContact.officialAccount}</span>
            <a href={publicSiteLinks.linuxDo} target="_blank" rel="noreferrer">LINUX DO</a>
            <a href={publicSiteLinks.zhihu} target="_blank" rel="noreferrer">知乎</a>
          </section>

          <section>
            <h2>购买服务</h2>
            <span>{publicContact.serviceDescription}</span>
            <strong>微信：{publicContact.serviceWechat}</strong>
          </section>
        </div>
      </div>

      <div className="footer-bottom">
        <p className="footer-data-status"><DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} variant="inline" /> · 汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</p>
        <p>价格、购买资格和税费以对应地区 Apple 结算页为准。</p>
        <p className="footer-copyright">© {new Date().getFullYear()} App Store 全球价格 · 本站与 Apple Inc. 无隶属关系</p>
      </div>
    </footer>
  );
}
