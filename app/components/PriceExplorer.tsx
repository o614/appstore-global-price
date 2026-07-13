"use client";

import { useMemo, useState } from "react";
import {
  findPlanItem,
  regionMeta,
  toCny,
  type AppSnapshot,
  type PlanDefinition,
} from "../lib/catalog";

export function PriceExplorer({ app, plans }: { app: AppSnapshot; plans: PlanDefinition[] }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];

  const rows = useMemo(() => {
    if (!selectedPlan) return [];
    return app.regions.map((region) => {
      const item = findPlanItem(region, selectedPlan);
      return {
        region,
        item,
        cny: item ? toCny(item.price, region.region) : null,
      };
    });
  }, [app, selectedPlan]);

  const ranked = rows
    .filter((row) => row.item && row.cny !== null)
    .sort((a, b) => (a.cny ?? Infinity) - (b.cny ?? Infinity));
  const lowest = ranked[0];
  const highest = ranked[ranked.length - 1];
  const saving = lowest && highest && highest.cny
    ? Math.round((1 - (lowest.cny ?? 0) / highest.cny) * 100)
    : null;

  if (!plans.length) {
    return (
      <div className="no-iap-panel">
        <span className="no-iap-mark">—</span>
        <h2>Apple 商品页暂未公开内购项目</h2>
        <p>这不代表应用没有付费服务，只表示当前公开页面没有可用于比较的 App Store 内购价格。</p>
      </div>
    );
  }

  return (
    <div className="price-explorer">
      <div className="plan-strip" role="tablist" aria-label="选择套餐">
        {plans.map((plan) => (
          <button
            key={plan.id}
            className={plan.id === selectedPlan.id ? "plan-chip active" : "plan-chip"}
            onClick={() => setSelectedId(plan.id)}
            role="tab"
            aria-selected={plan.id === selectedPlan.id}
          >
            <strong>{plan.label}</strong>
            <span>{plan.period}</span>
          </button>
        ))}
      </div>

      <div className="price-summary-grid">
        <div className="lowest-card">
          <span className="summary-label">参考折算最低</span>
          <strong>{lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据"}</strong>
          <p>{lowest ? `${regionMeta[lowest.region.region].flag} ${regionMeta[lowest.region.region].name}` : "当前套餐可比地区不足"}</p>
        </div>
        <div className="summary-mini-card">
          <span>有效地区</span>
          <strong>{ranked.length}<small>/10</small></strong>
        </div>
        <div className="summary-mini-card">
          <span>最高差幅</span>
          <strong>{saving === null ? "—" : `${saving}%`}</strong>
        </div>
      </div>

      <div className="price-table-wrap">
        <table className="price-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>地区</th>
              <th>Apple 当前标价</th>
              <th>人民币参考</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, index) => {
              const meta = regionMeta[row.region.region];
              return (
                <tr key={row.region.region}>
                  <td><span className={index === 0 ? "rank first" : "rank"}>{index + 1}</span></td>
                  <td><span className="region-name"><b>{meta.flag}</b>{meta.name}</span></td>
                  <td className="original-price">{row.item?.price} <small>{meta.currency}</small></td>
                  <td className="cny-price">¥{row.cny?.toFixed(2)}</td>
                  <td>{index === 0 ? <span className="best-pill">参考最低</span> : <span className="verified-pill">已验证</span>}</td>
                </tr>
              );
            })}
            {rows.filter((row) => !row.item).map((row) => {
              const meta = regionMeta[row.region.region];
              const unavailable = row.region.status === "error:HTTP 404";
              return (
                <tr className="muted-row" key={row.region.region}>
                  <td>—</td>
                  <td><span className="region-name"><b>{meta.flag}</b>{meta.name}</span></td>
                  <td colSpan={2}>{unavailable ? "该地区未上架或当前不可用" : "未确认到同一套餐"}</td>
                  <td><span className="unavailable-pill">{unavailable ? "不可用" : "不排名"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
