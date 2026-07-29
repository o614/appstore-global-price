"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RightSmallLine, SearchLine } from "@mingcute/react";
import type { AppSnapshot, CoverageSummary } from "../lib/catalog";
import { AppArtwork } from "./AppArtwork";

type CardData = AppSnapshot & {
  coverage: CoverageSummary;
  planCount: number;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function AppDirectory({ apps, regionCount }: { apps: CardData[]; regionCount: number }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const keyword = normalizeSearch(query.trim());
    if (!keyword) return apps;
    return apps.filter((app) => {
      const searchable = [
        app.matchedName,
        app.developer,
        app.query,
        app.id,
        app.category,
        app.group,
        app.service,
      ]
        .filter(Boolean)
        .join(" ");
      return normalizeSearch(searchable).includes(keyword);
    });
  }, [apps, query]);
  return (
    <section className="directory" id="apps">
      <div className="section-heading">
        <div>
          <span className="eyebrow">应用与订阅服务</span>
          <h2>选择应用，比较订阅价格</h2>
          <p className="directory-scope">固定比较 {regionCount} 个常用地区，保持不同应用和不同时间的结果可比。</p>
        </div>
        <div className="catalog-search-wrap">
          <label className="catalog-search">
            <SearchLine className="ui-icon" aria-hidden="true" />
            <input
              id="app-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="搜索精选应用"
              aria-label="搜索精选应用"
            />
          </label>
          <Link className="catalog-global-link" href="/search/">未收录？搜索其他 App</Link>
        </div>
      </div>

      <div className="app-grid">
        {filtered.map((app) => {
          const available = app.planCount > 0 && app.coverage.verified > 0;
          const needsReview = app.coverage.review > 0;
          const statusLabel = needsReview ? "待复核" : "价格未公开";
          return (
            <a className="app-card" href={`/apps/${app.id}`} key={app.id}>
              <AppArtwork app={app} className="app-icon" size={58} />
              <div className="app-card-copy">
                <div className="app-card-title-row">
                  <h3>{app.matchedName}</h3>
                  {!available && (
                    <span className={needsReview ? "status-dot review" : "status-dot limited"}>
                      {statusLabel}
                    </span>
                  )}
                </div>
                <p>{app.developer}</p>
                <div className="app-card-meta">
                  <span>{app.coverage.verified}/{app.coverage.total} 地区</span>
                  {available && <span>{app.planCount} 个套餐</span>}
                  {app.coverage.review > 0 && <span className="meta-review">{app.coverage.review} 地区待复核</span>}
                </div>
              </div>
              <RightSmallLine className="card-arrow ui-icon" aria-hidden="true" />
            </a>
          );
        })}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <p>精选目录中没有找到相关应用。</p>
          <Link href={`/search/?q=${encodeURIComponent(query.trim())}`}>搜索全部 App</Link>
        </div>
      )}
    </section>
  );
}
