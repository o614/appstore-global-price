import { AppDirectory } from "./components/AppDirectory";
import {
  apps,
  dataUpdatedAt,
  findPlanItem,
  getPublicItemRange,
  getRegionStoreUrl,
  getVerifiedRegionCount,
  planDefinitions,
  rateAttributionUrl,
  rateProvider,
  regionMeta,
  toCny,
} from "./lib/catalog";

const cardApps = apps.map((app) => ({
  ...app,
  verifiedCount: getVerifiedRegionCount(app),
  planCount: planDefinitions[app.id]?.length ?? 0,
  itemRange: getPublicItemRange(app),
}));

export default function Home() {
  const chatgpt = cardApps.find((app) => app.id === "6448311069")!;
  const featuredPlan = planDefinitions[chatgpt.id]?.find((plan) => plan.id === "plus-monthly");
  const featuredRows = featuredPlan
    ? chatgpt.regions
        .map((region) => {
          const item = findPlanItem(region, featuredPlan);
          return { region, item, cny: item ? toCny(item.price, region.region) : null };
        })
        .filter((row) => row.item && row.cny !== null)
        .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity))
    : [];
  const featuredLowest = featuredRows[0];
  const verifiedStorePages = cardApps.reduce((total, app) => total + app.verifiedCount, 0);
  const regionCount = Object.keys(regionMeta).length;

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
          <span className="live-badge"><i /> Apple 快照 {dataUpdatedAt}</span>
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
            <div><strong>{apps.length}</strong><span>首批应用</span></div>
            <div><strong>{regionCount}</strong><span>验证地区</span></div>
            <div><strong>{verifiedStorePages}</strong><span>有效商店页面</span></div>
          </div>
        </div>

        <article className="hero-price-card">
          <div className="featured-app">
            <img src={chatgpt.icon} alt="" />
            <div><span>首版示例</span><h2>ChatGPT Plus</h2><p>月付套餐 · 全球公开价格</p></div>
            <a href={`/apps/${chatgpt.id}`} aria-label="查看 ChatGPT 详细比价">↗</a>
          </div>
          <div className="price-spotlight">
            <span>参考折算最低</span>
            <strong>{featuredLowest ? regionMeta[featuredLowest.region.region].name : "暂无完整数据"}</strong>
            <div><b>{featuredLowest?.item?.price ?? "—"}</b><em>{featuredLowest?.cny ? `约 ¥${featuredLowest.cny.toFixed(2)}` : "等待验证"}</em></div>
          </div>
          <div className="mini-regions">
            {featuredRows.slice(0, 3).map((row) => {
              const meta = regionMeta[row.region.region];
              return <a href={getRegionStoreUrl(chatgpt.id, row.region.region)} target="_blank" rel="noreferrer" key={row.region.region}><span>{meta.flag} {meta.name}</span><b>¥{row.cny?.toFixed(2)}</b></a>;
            })}
          </div>
          <a className="card-detail-link" href={`/apps/${chatgpt.id}`}>查看月付、年付和地区套餐差异 <span>→</span></a>
        </article>
      </section>

      <section className="data-proof" aria-label="数据真实性说明">
        <div><strong>Apple 原始标价</strong><span>每个地区直接读取对应 App Store 商品页</span></div>
        <div><strong>套餐数量不补齐</strong><span>美国 6 项、日本 5 项会按真实页面分别展示</span></div>
        <div><strong>汇率只作参考</strong><span>购买判断以国家链接打开后的 Apple 页面为准</span></div>
      </section>

      <AppDirectory apps={cardApps} />

      <section className="method-section" id="method">
        <div className="method-copy">
          <span className="eyebrow">不只给你一个“最低价”</span>
          <h2>每个数字，都说明它从哪里来。</h2>
          <p>我们只比较已确认属于同一套餐、同一周期的数据。同名月付与年付分别呈现；无法匹配的项目宁可标记“不排名”，也不制造一个看似精确的结论。</p>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>锁定同一应用</h3><p>所有地区使用同一个 Apple App ID，不重复按名称搜索。</p></article>
          <article><span>02</span><h3>保留原币标价</h3><p>Apple 商店公开价格是主体，人民币金额仅为每日汇率折算。</p></article>
          <article><span>03</span><h3>链接对应国家商店</h3><p>地区名称只在该地区页面可用时提供 Apple 商店链接。</p></article>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">AP</span><span><strong>App Store</strong><small>全球价格</small></span></div>
        <p>应用价格验证于 {dataUpdatedAt} · 汇率由 <a href={rateAttributionUrl} target="_blank" rel="noreferrer">{rateProvider}</a> 提供</p>
        <p>页面展示抓取时点的公开快照；实际价格、可购资格与税费以对应地区 Apple 结算页为准。</p>
      </footer>
    </main>
  );
}
