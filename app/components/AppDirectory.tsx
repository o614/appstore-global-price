"use client";

import { useMemo, useState } from "react";
import { ExternalLinkLine, SearchLine } from "@mingcute/react";
import type { AppSnapshot, CoverageSummary } from "../lib/catalog";
import { AppArtwork } from "./AppArtwork";

type CardData = AppSnapshot & {
  coverage: CoverageSummary;
  planCount: number;
};

export function AppDirectory({ apps }: { apps: CardData[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return apps;
    return apps.filter((app) =>
      `${app.matchedName} ${app.developer} ${app.category ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [apps, query]);

  return (
    <section className="directory" id="apps">
      <div className="section-heading">
        <div>
          <span className="eyebrow">应用与订阅服务</span>
          <h2>选择应用，查看全球价格</h2>
        </div>
        <label className="catalog-search">
          <SearchLine className="ui-icon" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索应用或开发者"
            aria-label="搜索应用或开发者"
          />
        </label>
      </div>

      <div className="app-grid">
        {filtered.map((app) => {
          const available = app.planCount > 0 && app.coverage.verified > 0;
          const needsReview = app.coverage.review > 0;
          const statusLabel = available ? "可比价" : needsReview ? "待复核" : "价格未公开";
          return (
            <a className="app-card" href={`/apps/${app.id}`} key={app.id}>
              <AppArtwork app={app} className="app-icon" size={58} />
              <div className="app-card-copy">
                <div className="app-card-title-row">
                  <h3>{app.matchedName}</h3>
                  <span className={available ? "status-dot ready" : needsReview ? "status-dot review" : "status-dot limited"}>
                    {statusLabel}
                  </span>
                </div>
                <p>{app.developer}</p>
                <div className="app-card-meta">
                  <span>{app.category ?? "App"}</span>
                  <span>{app.coverage.verified}/{app.coverage.total} 地区</span>
                  {available && <span>{app.planCount} 个套餐</span>}
                  {app.coverage.review > 0 && <span className="meta-review">{app.coverage.review} 地区待复核</span>}
                </div>
              </div>
              <ExternalLinkLine className="card-arrow ui-icon" aria-hidden="true" />
            </a>
          );
        })}
      </div>
      {!filtered.length && <p className="empty-state">没有找到相关应用。</p>}
    </section>
  );
}
