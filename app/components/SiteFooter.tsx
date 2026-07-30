import Link from "next/link";
import { DataFreshness } from "./DataFreshness";
import { dataGeneratedAt, dataUpdatedAt, rateAttributionUrl, rateProvider } from "../lib/catalog";
import { publicSiteLinks, publicStatusPageUrl } from "../lib/site";

const showFooterDirectory = false;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      {showFooterDirectory && <nav className="footer-directory" aria-label="页脚导航">
        <section>
          <h2>价格服务</h2>
          <div className="footer-links">
            <Link href="/#apps">应用目录</Link>
            <Link href="/changes/">订阅变动</Link>
            <a href={publicSiteLinks.customerService} target="_blank" rel="noreferrer">联系客服</a>
          </div>
        </section>

        <section>
          <h2>文章教程</h2>
          <div className="footer-links">
            <a href={publicSiteLinks.registerTutorial} target="_blank" rel="noreferrer">注册教程</a>
            <a href={publicSiteLinks.regionTutorial} target="_blank" rel="noreferrer">改区教程</a>
            <a href={publicSiteLinks.rechargeTutorial} target="_blank" rel="noreferrer">充值教程</a>
            <a href={publicSiteLinks.moreTutorials} target="_blank" rel="noreferrer">更多教程</a>
          </div>
        </section>

        <section>
          <h2>联系作者</h2>
          <div className="footer-links">
            <a href={publicSiteLinks.officialAccount} target="_blank" rel="noreferrer">公众号</a>
            <a href={publicSiteLinks.zhihu} target="_blank" rel="noreferrer">知乎</a>
            <a href={publicSiteLinks.linuxDo} target="_blank" rel="noreferrer">LINUX DO</a>
          </div>
        </section>
      </nav>}

      <div className="footer-service-note">
        <p>
          <DataFreshness generatedAt={dataGeneratedAt} displayDate={dataUpdatedAt} variant="inline" />
          <span className="footer-service-separator" aria-hidden="true">·</span>
          <span>汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</span>
          <span className="footer-service-separator" aria-hidden="true">·</span>
          <span>价格、购买资格和税费以对应地区 Apple 结算页为准。</span>
        </p>
      </div>

      <div className="footer-legal">
        <p className="footer-copyright">© {new Date().getFullYear()} App Store 订阅比价 · 本站与 Apple Inc. 无隶属关系</p>
        <a className="footer-status-link" href={publicStatusPageUrl} target="_blank" rel="noreferrer">
          <span className="footer-status-indicator" aria-hidden="true" />
          系统状态
        </a>
      </div>
    </footer>
  );
}
