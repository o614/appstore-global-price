import type { Metadata } from "next";
import Link from "next/link";
import changeLogData from "../../data/price-change-log.json";
import { RegionFlag } from "../components/RegionFlag";
import { apps, dataGeneratedAt, regionMeta } from "../lib/catalog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";

export const metadata: Metadata = {
  title: "价格变动日志 | App Store 全球价格",
  description: "查看已经校验并发布的 App Store 应用与 Apple 订阅服务价格变化。",
  alternates: { canonical: "/changes/" },
  openGraph: {
    title: "价格变动日志 | App Store 全球价格",
    description: "查看已经校验并发布的 App Store 应用与 Apple 订阅服务价格变化。",
    type: "website",
    url: `${siteUrl}/changes/`,
  },
};

type EvidenceState = "verified" | "service-unavailable" | "official-price-unpublished" | "parse-failed";
type PriceItem = { name: string; price: string };
type PriceUpdate = { name: string; beforePrice: string; afterPrice: string };
type RegionPriceChange = {
  type: "region-items-changed";
  appId: string;
  appName: string;
  region: string;
  beforeState?: EvidenceState;
  afterState?: EvidenceState;
  updated?: PriceUpdate[];
  added?: PriceItem[];
  removed?: PriceItem[];
};
type CatalogChange = {
  type: "app-added" | "app-removed" | "region-added" | "region-removed";
  appId: string;
  appName: string;
  region?: string;
};
type PriceChange = RegionPriceChange | CatalogChange;
type ChangeLogEntry = {
  id: string;
  publishedAt: string;
  checkedAt?: string;
  changeCount: number;
  changes: PriceChange[];
};
type ChangeLog = { version: number; entries: ChangeLogEntry[] };

const changeLog = changeLogData as ChangeLog;
const knownApps = new Set(apps.map((app) => app.id));
const stateLabels: Record<EvidenceState, string> = {
  verified: "价格已验证",
  "service-unavailable": "服务不可用",
  "official-price-unpublished": "官方价格未公开",
  "parse-failed": "解析失败",
};

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function ChangeDetails({ change }: { change: PriceChange }) {
  if (change.type !== "region-items-changed") {
    const copy = {
      "app-added": "新增应用或服务",
      "app-removed": "停止展示应用或服务",
      "region-added": "新增比价地区",
      "region-removed": "移除比价地区",
    }[change.type];
    return <p className="change-catalog-event">{copy}</p>;
  }

  const stateChanged = change.beforeState && change.afterState && change.beforeState !== change.afterState;
  const details = [
    ...(change.updated ?? []).map((item) => ({ kind: "adjusted", item })),
    ...(change.added ?? []).map((item) => ({ kind: "added", item })),
    ...(change.removed ?? []).map((item) => ({ kind: "removed", item })),
  ];

  return (
    <div className="change-details">
      {stateChanged ? (
        <div className="change-state-row">
          <span className={`evidence-state evidence-${change.beforeState}`}>{stateLabels[change.beforeState!]}</span>
          <span aria-hidden="true">→</span>
          <span className={`evidence-state evidence-${change.afterState}`}>{stateLabels[change.afterState!]}</span>
        </div>
      ) : null}
      {details.map(({ kind, item }, index) => {
        if (kind === "adjusted") {
          const update = item as PriceUpdate;
          return (
            <div className="change-detail-row" key={`${kind}-${update.name}-${index}`}>
              <span className="change-kind kind-adjusted">调价</span>
              <strong>{update.name}</strong>
              <span className="price-transition">
                <del>{update.beforePrice}</del>
                <span aria-hidden="true">→</span>
                <b>{update.afterPrice}</b>
              </span>
            </div>
          );
        }
        const plan = item as PriceItem;
        return (
          <div className="change-detail-row" key={`${kind}-${plan.name}-${index}`}>
            <span className={`change-kind kind-${kind}`}>{kind === "added" ? "新增" : "移除"}</span>
            <strong>{plan.name}</strong>
            <span className="single-price">{plan.price}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ChangesPage() {
  const entries = changeLog.entries.filter((entry) => entry.changes.length > 0);

  return (
    <main className="change-log-page">
      <header className="site-header detail-header">
        <Link className="brand" href="/" aria-label="App Store 全球价格首页">
          <span className="brand-mark">AP</span>
          <span><strong>App Store</strong><small>全球价格</small></span>
        </Link>
        <nav>
          <Link href="/#apps">应用目录</Link>
          <Link href="/changes/" aria-current="page">价格日志</Link>
          <Link className="back-link" href="/">返回首页</Link>
        </nav>
      </header>

      <section className="change-log-hero">
        <span className="eyebrow">PRICE CHANGE LOG</span>
        <h1>每一次价格变化，<br />都有记录。</h1>
        <p>这里只记录已经通过校验并发布到网站的变化。Bark 提醒的是候选变化，确认发布后才会出现在这里。</p>
        <div className="change-log-legend" aria-label="日志类型说明">
          <span><i className="legend-adjusted" />同一套餐调价</span>
          <span><i className="legend-added" />新增套餐</span>
          <span><i className="legend-removed" />移除套餐</span>
        </div>
      </section>

      {entries.length ? (
        <section className="change-log-section" aria-labelledby="change-log-title">
          <div className="change-log-heading">
            <div>
              <span className="eyebrow">已发布记录</span>
              <h2 id="change-log-title">最近的价格变动</h2>
            </div>
            <p>共 {entries.length} 次发布记录</p>
          </div>
          <div className="change-log-list">
            {entries.map((entry) => (
              <article className="change-entry" key={entry.id}>
                <header className="change-entry-header">
                  <time dateTime={entry.publishedAt}>{formatPublishedAt(entry.publishedAt)}</time>
                  <span>{entry.changeCount} 个应用或地区有变化</span>
                </header>
                <div className="change-entry-items">
                  {entry.changes.map((change, index) => {
                    const meta = change.region ? regionMeta[change.region] : null;
                    return (
                      <section className="change-row" key={`${change.type}-${change.appId}-${change.region ?? "all"}-${index}`}>
                        <div className="change-row-heading">
                          <div>
                            {knownApps.has(change.appId)
                              ? <Link href={`/apps/${change.appId}/`}>{change.appName}</Link>
                              : <strong>{change.appName}</strong>}
                            {meta && change.region ? (
                              <span className="change-region">
                                <RegionFlag code={change.region} name={meta.name} />
                                {meta.name}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <ChangeDetails change={change} />
                      </section>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="change-log-empty" aria-labelledby="empty-log-title">
          <span className="empty-log-mark" aria-hidden="true">00</span>
          <div>
            <span className="eyebrow">等待第一条记录</span>
            <h2 id="empty-log-title">暂时还没有已发布的价格变动。</h2>
            <p>从下一次正式价格更新开始，这里会自动记录应用、地区、套餐以及调价前后的原币金额，不补写未经验证的历史。</p>
          </div>
          <Link href="/#apps">查看当前价格</Link>
        </section>
      )}

      <section className="change-log-note">
        <h2>状态变化也会被单独记录</h2>
        <p>“服务不可用”“官方价格未公开”和“解析失败”代表不同情况。系统不会猜测国家页面，也不会用其他地区的价格补齐。</p>
        <span>当前价格数据生成于 {formatPublishedAt(dataGeneratedAt)}</span>
      </section>
    </main>
  );
}
