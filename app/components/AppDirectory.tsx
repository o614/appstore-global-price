"use client";

import { useMemo, useState } from "react";
import type { AppSnapshot } from "../lib/catalog";

type CardData = AppSnapshot & { verifiedCount: number; planCount: number; itemRange: { min: number; max: number } };

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
          <span className="eyebrow">首批验证目录</span>
          <h2>从你真正会订阅的应用开始</h2>
        </div>
        <label className="catalog-search">
          <span aria-hidden="true">⌕</span>
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
          const available = app.planCount > 0;
          return (
            <a className="app-card" href={`/apps/${app.id}`} key={app.id}>
              <img src={app.icon} alt="" className="app-icon" loading="lazy" />
              <div className="app-card-copy">
                <div className="app-card-title-row">
                  <h3>{app.matchedName}</h3>
                  <span className={available ? "status-dot ready" : "status-dot limited"}>
                    {available ? "可比价" : "未公开内购"}
                  </span>
                </div>
                <p>{app.developer}</p>
                <div className="app-card-meta">
                  <span>{app.category ?? "App"}</span>
                  <span>{app.verifiedCount}/{app.regions.length} 地区已验证</span>
                  <span>{app.itemRange.min === app.itemRange.max ? `${app.itemRange.max} 项/地区` : `${app.itemRange.min}–${app.itemRange.max} 项/地区`}</span>
                  <span>{app.planCount} 个可识别套餐</span>
                </div>
              </div>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </a>
          );
        })}
      </div>
      {!filtered.length && <p className="empty-state">暂未收录这个应用，第一版会逐步扩大目录。</p>}
    </section>
  );
}
