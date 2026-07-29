import type { Metadata } from "next";
import Link from "next/link";
import {
  AddCircleLine,
  ArrowRightLine,
  Delete2Line,
  DownSmallLine,
  History2Line,
  InformationLine,
  TransferHorizontalLine,
} from "@mingcute/react";
import changeLogData from "../../data/price-change-log.json";
import { RegionFlag } from "../components/RegionFlag";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { apps, dataGeneratedAt, regionMeta } from "../lib/catalog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://price.290935.xyz";

export const metadata: Metadata = {
  title: "订阅变动日志 | App Store 订阅比价",
  description: "查看已经校验并发布的套餐调价、新增、移除以及应用、地区与可用状态变化。",
  alternates: { canonical: "/changes/" },
  openGraph: {
    title: "订阅变动日志 | App Store 订阅比价",
    description: "查看已经校验并发布的套餐调价、新增、移除以及应用、地区与可用状态变化。",
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
          <ArrowRightLine className="ui-icon transition-icon" aria-hidden="true" />
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
                <ArrowRightLine className="ui-icon transition-icon" aria-hidden="true" />
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
  const entries = changeLog.entries.filter((entry) => entry.changes.length > 0).slice(0, 30);

  return (
    <main className="change-log-page">
      <SiteHeader active="changes" />

      <section className="change-log-hero">
        <span className="eyebrow">SUBSCRIPTION CHANGE LOG</span>
        <h1>套餐与价格的每一次变化，<br />都有记录。</h1>
        <p>这里记录已经验证并发布的套餐调价、新增、移除，以及应用、地区与可用状态变化。</p>
        <div className="change-log-legend" aria-label="日志类型说明">
          <span><TransferHorizontalLine className="legend-adjusted ui-icon" aria-hidden="true" />同一套餐调价</span>
          <span><AddCircleLine className="legend-added ui-icon" aria-hidden="true" />新增套餐</span>
          <span><Delete2Line className="legend-removed ui-icon" aria-hidden="true" />移除套餐</span>
          <span><InformationLine className="ui-icon" aria-hidden="true" />应用、地区与状态变化</span>
        </div>
      </section>

      {entries.length ? (
        <section className="change-log-section" aria-labelledby="change-log-title">
          <div className="change-log-heading">
            <div>
              <span className="eyebrow">已发布记录</span>
              <h2 id="change-log-title">最近的订阅变动</h2>
            </div>
            <p>展示最近 {entries.length} 次发布记录</p>
          </div>
          <div className="change-log-list">
            {entries.map((entry, entryIndex) => (
              <details className="change-entry" key={entry.id} open={entryIndex === 0}>
                <summary className="change-entry-summary">
                  <span className="change-entry-header">
                    <time dateTime={entry.publishedAt}>{formatPublishedAt(entry.publishedAt)}</time>
                    <span>{entry.changeCount} 个应用或地区有变化</span>
                  </span>
                  <span className="change-entry-action">
                    <span className="change-entry-action-collapsed">查看详情</span>
                    <span className="change-entry-action-expanded">收起详情</span>
                    <DownSmallLine className="ui-icon" aria-hidden="true" />
                  </span>
                </summary>
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
              </details>
            ))}
          </div>
        </section>
      ) : (
        <section className="change-log-empty" aria-labelledby="empty-log-title">
          <History2Line className="empty-log-mark" aria-hidden="true" />
          <div>
            <span className="eyebrow">等待第一条记录</span>
            <h2 id="empty-log-title">暂时还没有已发布的订阅变动。</h2>
            <p>从下一次正式更新开始，这里会自动记录应用、地区、套餐新增与移除，以及调价前后的原币金额，不补写未经验证的历史。</p>
          </div>
          <Link href="/#apps">查看当前订阅价格 <ArrowRightLine className="ui-icon" aria-hidden="true" /></Link>
        </section>
      )}

      <section className="change-log-note">
        <span>只保留最近 30 次正式发布记录 · 当前价格数据生成于 {formatPublishedAt(dataGeneratedAt)}</span>
      </section>
      <SiteFooter />
    </main>
  );
}
