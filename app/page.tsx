import { AppDirectory } from "./components/AppDirectory";
import {
  apps,
  dataUpdatedAt,
  getVerifiedRegionCount,
  planDefinitions,
  rateAttributionUrl,
  rateProvider,
} from "./lib/catalog";

const cardApps = apps.map((app) => ({
  ...app,
  verifiedCount: getVerifiedRegionCount(app),
  planCount: planDefinitions[app.id]?.length ?? 0,
}));

export default function Home() {
  const chatgpt = cardApps.find((app) => app.id === "6448311069")!;
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="App Store 全球价格首页">
          <span className="brand-mark">AP</span>
          <span><strong>App Store</strong><small>全球价格</small></span>
        </a>
        <nav>
          <a href="#apps">应用目录</a>
          <a href="#method">数据说明</a>
          <span className="live-badge"><i /> 已验证样本</span>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">GLOBAL IN-APP PRICE INDEX</span>
          <h1>先看清价格，<br />再决定在哪个区买。</h1>
          <p>把同一个 App 的内购与订阅放进一张可信、可解释的全球价格表。原币标价优先，人民币仅作参考。</p>
          <div className="hero-actions">
            <a href="#apps" className="primary-button">开始比较 <span>→</span></a>
            <a href="/apps/6448311069" className="text-button">查看 ChatGPT 示例</a>
          </div>
          <div className="hero-stats">
            <div><strong>10</strong><span>首批应用</span></div>
            <div><strong>10</strong><span>验证地区</span></div>
            <div><strong>100</strong><span>商店页面样本</span></div>
          </div>
        </div>

        <a className="hero-price-card" href={`/apps/${chatgpt.id}`}>
          <div className="featured-app">
            <img src={chatgpt.icon} alt="" />
            <div><span>本周热门</span><h2>ChatGPT Plus</h2><p>月度订阅 · 全球公开价格</p></div>
            <b>↗</b>
          </div>
          <div className="price-spotlight">
            <span>参考最低</span>
            <strong>菲律宾</strong>
            <div><b>₱999</b><em>约 ¥110</em></div>
          </div>
          <div className="mini-regions">
            <div><span>🇵🇭 菲律宾</span><b>¥110</b></div>
            <div><span>🇵🇰 巴基斯坦</span><b>¥120</b></div>
            <div><span>🇺🇸 美国</span><b>¥136</b></div>
          </div>
          <p className="card-footnote">同一套餐 · 同一 App ID · 数据状态可追溯</p>
        </a>
      </section>

      <AppDirectory apps={cardApps} />

      <section className="method-section" id="method">
        <div className="method-copy">
          <span className="eyebrow">不只给你一个“最低价”</span>
          <h2>每个数字，都说明它从哪里来。</h2>
          <p>我们只比较已确认属于同一套餐的数据。无法判断月付、年付或本地化名称时，宁可标记“不排名”，也不制造一个看似精确的结论。</p>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>锁定同一应用</h3><p>所有地区使用同一个 Apple App ID，不重复按名称搜索。</p></article>
          <article><span>02</span><h3>保留原币标价</h3><p>Apple 商店公开价格是主体，人民币金额仅为每日汇率折算。</p></article>
          <article><span>03</span><h3>区分数据状态</h3><p>未上架、未公开内购、无法匹配和抓取失败不会混为一谈。</p></article>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">AP</span><span><strong>App Store</strong><small>全球价格</small></span></div>
        <p>应用价格验证于 {dataUpdatedAt} · 汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</p>
        <p>实际价格、可购资格与税费以对应地区 Apple 结算页为准。</p>
      </footer>
    </main>
  );
}
