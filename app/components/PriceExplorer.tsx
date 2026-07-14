"use client";

import { useEffect, useMemo, useState } from "react";
import {
  dataUpdatedAt,
  findPlanItem,
  getRegionStoreUrl,
  regionMeta,
  toCny,
  type AppSnapshot,
  type PlanDefinition,
} from "../lib/catalog";

export function PriceExplorer({ app, plans }: { app: AppSnapshot; plans: PlanDefinition[] }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];

  useEffect(() => {
    const planId = new URL(window.location.href).searchParams.get("plan");
    if (planId && plans.some((plan) => plan.id === planId)) setSelectedId(planId);
  }, [plans]);

  useEffect(() => {
    if (!isShareOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsShareOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isShareOpen]);

  const rows = useMemo(() => {
    if (!selectedPlan) return [];
    return app.regions.map((region) => {
      const item = findPlanItem(region, selectedPlan);
      return { region, item, cny: item ? toCny(item.price, region.region) : null };
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

  function getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("plan", selectedPlan.id);
    url.hash = "comparison";
    return url.toString();
  }

  function getShareText() {
    const lowestText = lowest
      ? `${regionMeta[lowest.region.region].name}，约 ¥${lowest.cny?.toFixed(2)}`
      : "暂无完整数据";
    const savingText = saving === null ? "" : `，地区最高价差约 ${saving}%`;
    return `${app.matchedName} · ${selectedPlan.label}（${selectedPlan.period}）\n参考最低：${lowestText}${savingText}\n数据：Apple 公开商品页，更新于 ${dataUpdatedAt}\n${getShareUrl()}`;
  }

  async function copyText(text: string, feedback: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setShareFeedback(feedback);
      window.setTimeout(() => setShareFeedback(""), 1800);
    } catch {
      setShareFeedback("复制失败，请稍后重试");
    }
  }

  async function shareResult() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${app.matchedName} 全球价格`,
          text: `${selectedPlan.label}（${selectedPlan.period}）全球价格对比`,
          url: getShareUrl(),
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyText(getShareUrl(), "链接已复制");
  }

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
      <div className="comparison-toolbar">
        <p className="plan-explanation">同名项目按 Apple 商品页中的独立价格项区分月付、年付；当前只排名所选套餐与周期。</p>
        <button className="share-result-button" type="button" onClick={() => setIsShareOpen(true)}>
          <span aria-hidden="true">↗</span> 分享当前比价
        </button>
      </div>

      <div className="price-summary-grid">
        <div className="lowest-card">
          <span className="summary-label">参考折算最低</span>
          <strong>{lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据"}</strong>
          <p>{lowest ? `${regionMeta[lowest.region.region].flag} ${regionMeta[lowest.region.region].name} · ${selectedPlan.period}` : "当前套餐可比地区不足"}</p>
        </div>
        <div className="summary-mini-card">
          <span>有效地区</span>
          <strong>{ranked.length}<small>/{app.regions.length}</small></strong>
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
              <th className="col-rank">排名</th>
              <th className="col-region">地区</th>
              <th className="col-items">地区公开项目</th>
              <th className="col-original">Apple 当前标价</th>
              <th className="col-cny">人民币参考</th>
              <th className="col-status">状态</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, index) => {
              const meta = regionMeta[row.region.region];
              return (
                <tr key={row.region.region}>
                  <td className="col-rank"><span className={index === 0 ? "rank first" : "rank"}>{index + 1}</span></td>
                  <td className="col-region"><a className="region-name region-store-link" href={getRegionStoreUrl(app.id, row.region.region)} target="_blank" rel="noreferrer" title={`打开${meta.name} App Store`}><b>{meta.flag}</b><span>{meta.name}<small>打开商店 ↗</small></span></a></td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="original-price col-original">{row.item?.price} <small>{meta.currency}</small></td>
                  <td className="cny-price col-cny">¥{row.cny?.toFixed(2)}</td>
                  <td className="col-status">{index === 0 ? <span className="best-pill">参考最低</span> : <span className="verified-pill">Apple 已验证</span>}</td>
                </tr>
              );
            })}
            {rows.filter((row) => !row.item).map((row) => {
              const meta = regionMeta[row.region.region];
              const unavailable = row.region.status === "error:HTTP 404";
              const verified = row.region.status.startsWith("ok-");
              return (
                <tr className="muted-row" key={row.region.region}>
                  <td className="col-rank">—</td>
                  <td className="col-region">{verified ? <a className="region-name region-store-link" href={getRegionStoreUrl(app.id, row.region.region)} target="_blank" rel="noreferrer"><b>{meta.flag}</b><span>{meta.name}<small>打开商店 ↗</small></span></a> : <span className="region-name"><b>{meta.flag}</b>{meta.name}</span>}</td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="col-original muted-detail">{unavailable ? "该地区未上架" : verified ? "公开项目中未发现此套餐" : "本次抓取失败"}</td>
                  <td className="col-cny"><span className="unavailable-pill">{unavailable ? "不可用" : verified ? "未提供" : "待复核"}</span></td>
                  <td className="col-status"><span className="unavailable-pill">{unavailable ? "未上架" : verified ? "未参与排名" : "等待复核"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isShareOpen && (
        <div className="share-dialog-backdrop" onMouseDown={() => setIsShareOpen(false)}>
          <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="share-dialog-header">
              <div>
                <span>分享当前结果</span>
                <h2 id="share-dialog-title">把这一组价格发给朋友</h2>
              </div>
              <button type="button" className="share-dialog-close" onClick={() => setIsShareOpen(false)} aria-label="关闭分享弹窗">×</button>
            </div>

            <div className="share-result-card">
              <div className="share-card-brand"><span className="brand-mark">AP</span><small>App Store 全球价格</small></div>
              <div className="share-card-app">
                {app.icon && <img src={app.icon} alt="" />}
                <div><strong>{app.matchedName}</strong><span>{selectedPlan.label} · {selectedPlan.period}</span></div>
              </div>
              <div className="share-card-lowest">
                <span>参考折算最低</span>
                <strong>{lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据"}</strong>
                <small>{lowest ? `${regionMeta[lowest.region.region].flag} ${regionMeta[lowest.region.region].name}` : "当前套餐可比地区不足"}</small>
              </div>
              <ol className="share-card-ranking">
                {ranked.slice(0, 3).map((row, index) => {
                  const meta = regionMeta[row.region.region];
                  return <li key={row.region.region}><span>{index + 1} · {meta.flag} {meta.name}</span><b>{row.item?.price}</b><em>¥{row.cny?.toFixed(2)}</em></li>;
                })}
              </ol>
              <p>{ranked.length} 个地区可比{saving === null ? "" : ` · 最高价差约 ${saving}%`} · 数据更新 {dataUpdatedAt}</p>
            </div>

            <p className="share-dialog-note">分享内容会保留当前套餐和周期；人民币为汇率参考，实际扣款以对应地区 App Store 为准。</p>
            <div className="share-dialog-actions">
              <button type="button" className="share-primary" onClick={shareResult}>系统分享</button>
              <button type="button" onClick={() => copyText(getShareText(), "结果与链接已复制")}>复制结果</button>
              <button type="button" onClick={() => copyText(getShareUrl(), "链接已复制")}>复制链接</button>
            </div>
            <div className="share-feedback" role="status" aria-live="polite">{shareFeedback}</div>
          </section>
        </div>
      )}
    </div>
  );
}
