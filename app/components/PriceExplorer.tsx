"use client";

import { useEffect, useMemo, useState } from "react";
import {
  dataUpdatedAt,
  findPlanItem,
  getPriceSourceCopy,
  getRegionEvidenceState,
  getRegionPriceSourceUrl,
  getRegionStoreAppUrl,
  getRegionStoreUrl,
  getRegionSwitchUrl,
  regionMeta,
  toCny,
  type AppSnapshot,
  type PlanDefinition,
} from "../lib/catalog";
import { AppArtwork } from "./AppArtwork";
import { RegionFlag } from "./RegionFlag";

export function PriceExplorer({ app, plans }: { app: AppSnapshot; plans: PlanDefinition[] }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [selectedStoreRegion, setSelectedStoreRegion] = useState<string | null>(null);
  const [deviceKind, setDeviceKind] = useState<"unknown" | "ios" | "mac" | "other">("unknown");
  const [isWechat, setIsWechat] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];
  const sourceCopy = getPriceSourceCopy(app);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const planId = new URL(window.location.href).searchParams.get("plan");
      if (planId && plans.some((plan) => plan.id === planId)) setSelectedId(planId);
      const userAgent = navigator.userAgent;
      const isiPadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      if (/iPhone|iPad|iPod/i.test(userAgent) || isiPadDesktopMode) setDeviceKind("ios");
      else if (/Macintosh|Mac OS X/i.test(userAgent)) setDeviceKind("mac");
      else setDeviceKind("other");
      setIsWechat(/MicroMessenger/i.test(userAgent));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [plans]);

  useEffect(() => {
    if (!isShareOpen && !selectedStoreRegion) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsShareOpen(false);
        setSelectedStoreRegion(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isShareOpen, selectedStoreRegion]);

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
    return `${app.matchedName} · ${selectedPlan.label}（${selectedPlan.period}）\n参考最低：${lowestText}${savingText}\n数据：${sourceCopy.noun}，更新于 ${dataUpdatedAt}\n${getShareUrl()}`;
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

  function showStoreOptions(regionCode: string) {
    setShareFeedback("");
    setSelectedStoreRegion(regionCode);
  }

  function copyAppNameAndSwitch(switchUrl: string) {
    const textarea = document.createElement("textarea");
    let copied = false;
    try {
      textarea.value = app.query;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      textarea.remove();
    }
    if (!copied && navigator.clipboard?.writeText) void navigator.clipboard.writeText(app.query);
    window.location.assign(switchUrl);
  }

  if (!plans.length) {
    return (
      <div className="no-iap-panel">
        <span className="no-iap-mark">—</span>
        <h2>{sourceCopy.missing}</h2>
        <p>这不代表应用没有付费服务，只表示当前 Apple 官方公开页面没有可用于比较的价格。</p>
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
        <p className="plan-explanation">月付、年付与一次性购买分别排名。</p>
        <button className="share-result-button" type="button" onClick={() => setIsShareOpen(true)}>
          <span aria-hidden="true">↗</span> 分享当前比价
        </button>
      </div>

      <div className="price-summary-grid">
        <div className="lowest-card">
          <span className="summary-label">参考折算最低</span>
          <strong>{lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据"}</strong>
          <p>{lowest ? <><RegionFlag code={lowest.region.region} name={regionMeta[lowest.region.region].name} />{regionMeta[lowest.region.region].name} · {selectedPlan.period}</> : "当前套餐可比地区不足"}</p>
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
              const sourceUrl = getRegionPriceSourceUrl(app, row.region.region);
              return (
                <tr key={row.region.region}>
                  <td className="col-rank"><span className={index === 0 ? "rank first" : "rank"}>{index + 1}</span></td>
                  <td className="col-region">{app.priceSource !== "app-store" && sourceUrl
                    ? <a className="region-name region-store-link" href={sourceUrl} target="_blank" rel="noreferrer" title={`查看${meta.name} Apple 官方方案`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}<small>查看官方方案 ↗</small></span></a>
                    : <button className="region-name region-store-link" type="button" onClick={() => showStoreOptions(row.region.region)} title={`查看${meta.name} App Store 跳转方式`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}<small>查看跳转方式 ↗</small></span></button>}</td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="original-price col-original">{row.item?.price} <small>{meta.currency}</small></td>
                  <td className="cny-price col-cny">¥{row.cny?.toFixed(2)}</td>
                  <td className="col-status">{index === 0 ? <span className="best-pill">参考最低</span> : <span className="verified-pill">Apple 已验证</span>}</td>
                </tr>
              );
            })}
            {rows.filter((row) => !row.item).map((row) => {
              const meta = regionMeta[row.region.region];
              const evidenceState = getRegionEvidenceState(row.region);
              const sourceUrl = getRegionPriceSourceUrl(app, row.region.region);
              const isOfficialPriceMissing = row.region.status === "official-price-page-missing";
              const canOpenStore = Boolean(sourceUrl) && !isOfficialPriceMissing && (evidenceState === "verified" || evidenceState === "not-public");
              const detail = isOfficialPriceMissing
                ? "Apple 未提供该地区公开订阅价页面"
                : evidenceState === "unavailable"
                ? "该应用未在此地区上架"
                : evidenceState === "not-public"
                  ? "Apple 商品页未公开内购项目"
                  : evidenceState === "verified"
                    ? "公开项目中未发现此套餐"
                    : "价格待确认";
              const shortStatus = evidenceState === "unavailable"
                ? "不可用"
                : evidenceState === "not-public"
                  ? "未公开"
                  : evidenceState === "verified"
                    ? "未提供"
                    : "待复核";
              const rankStatus = isOfficialPriceMissing
                ? "无公开价格"
                : evidenceState === "unavailable"
                ? "未上架"
                : evidenceState === "not-public"
                  ? "无公开内购"
                  : evidenceState === "verified"
                    ? "未参与排名"
                    : "等待复核";
              const statusClass = evidenceState === "review" ? "review-pill" : evidenceState === "not-public" ? "not-public-pill" : "unavailable-pill";
              return (
                <tr className="muted-row" key={row.region.region}>
                  <td className="col-rank">—</td>
                  <td className="col-region">{canOpenStore ? (app.priceSource !== "app-store"
                    ? <a className="region-name region-store-link" href={sourceUrl ?? undefined} target="_blank" rel="noreferrer"><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}<small>查看官方方案 ↗</small></span></a>
                    : <button className="region-name region-store-link" type="button" onClick={() => showStoreOptions(row.region.region)}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}<small>查看跳转方式 ↗</small></span></button>) : <span className="region-name"><RegionFlag code={row.region.region} name={meta.name} size="regular" />{meta.name}</span>}</td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="col-original muted-detail">{detail}</td>
                  <td className="col-cny"><span className={statusClass}>{shortStatus}</span></td>
                  <td className="col-status"><span className={statusClass}>{rankStatus}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedStoreRegion && (() => {
        const meta = regionMeta[selectedStoreRegion];
        const switchUrl = getRegionSwitchUrl(selectedStoreRegion);
        const webUrl = getRegionStoreUrl(app.id, selectedStoreRegion);
        const appUrl = getRegionStoreAppUrl(app.id, selectedStoreRegion);
        return (
          <div className="share-dialog-backdrop" onMouseDown={() => setSelectedStoreRegion(null)}>
            <section className="share-dialog store-jump-dialog" role="dialog" aria-modal="true" aria-labelledby="store-jump-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="share-dialog-header">
                <div>
                  <span>跳转前确认</span>
                  <h2 id="store-jump-title"><RegionFlag code={selectedStoreRegion} name={meta.name} size="regular" />前往 {meta.name}区 App Store</h2>
                </div>
                <button type="button" className="share-dialog-close" onClick={() => setSelectedStoreRegion(null)} aria-label="关闭跳转提示">×</button>
              </div>

              <div className="store-redirect-warning">
                <strong>大陆网络会改写网页商店地区</strong>
                <p>直接打开 <code>apps.apple.com/{selectedStoreRegion}/…</code> 仍可能被重定向到中国大陆商店，因此这里不会直接跳转。</p>
              </div>

              {isWechat && <div className="store-browser-warning">检测到微信内置浏览器：请先用右上角“在 Safari 中打开”，再执行换区。</div>}

              {deviceKind === "ios" ? (
                <div className="store-device-panel">
                  <div className="store-device-heading"><span>已识别 iPhone / iPad</span><strong>复制名称并切换商店</strong></div>
                  <ol><li>点击主按钮，网站会先复制“{app.query}”，再将 App Store 切换为{meta.name}区。</li><li>换区完成后进入 App Store 搜索，直接粘贴应用名称即可。</li></ol>
                  <div className="store-jump-actions ios-actions">
                    {switchUrl && <button className="store-jump-primary" type="button" onClick={() => copyAppNameAndSwitch(switchUrl)}><strong>复制 {app.query} 并切换到{meta.name}区</strong><small>换区后前往搜索粘贴</small></button>}
                    <button type="button" onClick={() => copyText(app.query, `${app.query} 已复制`)}>仅复制应用名</button>
                    {switchUrl && <a href={switchUrl}>仅切换地区</a>}
                    <a href={appUrl}>切换后打开应用</a>
                  </div>
                </div>
              ) : deviceKind === "mac" ? (
                <div className="store-device-panel mac-panel">
                  <div className="store-device-heading"><span>已识别 Mac</span><strong>不自动调用换区深链</strong></div>
                  <p>该深链在 Mac App Store 上兼容性不稳定，可能无反应或报错。建议把换区链接发到 iPhone / iPad 操作。</p>
                  <div className="store-jump-actions compact">
                    {switchUrl && <button className="store-jump-primary" type="button" onClick={() => copyText(switchUrl, "换区链接已复制")}>复制换区链接</button>}
                    <button type="button" onClick={() => copyText(webUrl, "应用网页链接已复制")}>复制应用网页</button>
                    <a href={webUrl} target="_blank" rel="noreferrer">尝试打开网页</a>
                  </div>
                </div>
              ) : (
                <div className="store-device-panel other-panel">
                  <div className="store-device-heading"><span>未识别为 iPhone / iPad</span><strong>当前设备无法可靠切换 App Store</strong></div>
                  <p>可复制换区链接到 iPhone / iPad 的 Safari 中打开；网页入口可能仍被重定向到中国大陆商店。</p>
                  <div className="store-jump-actions compact">
                    {switchUrl && <button className="store-jump-primary" type="button" onClick={() => copyText(switchUrl, "换区链接已复制")}>复制换区链接</button>}
                    <button type="button" onClick={() => copyText(webUrl, "应用网页链接已复制")}>复制应用网页</button>
                    <a href={webUrl} target="_blank" rel="noreferrer">尝试打开网页</a>
                  </div>
                </div>
              )}

              <p className="store-jump-footnote">设备类型只在当前浏览器本地判断，不申请权限，也不会上传。Apple 的换区接口不能可靠附带应用页或搜索页，因此主按钮采用“先复制应用名，再换区”的稳定方式。</p>
              <div className="share-feedback" role="status" aria-live="polite">{shareFeedback}</div>
            </section>
          </div>
        );
      })()}

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
                <AppArtwork app={app} className="share-app-artwork" size={44} />
                <div><strong>{app.matchedName}</strong><span>{selectedPlan.label} · {selectedPlan.period}</span></div>
              </div>
              <div className="share-card-lowest">
                <span>参考折算最低</span>
                <strong>{lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据"}</strong>
                <small>{lowest ? <><RegionFlag code={lowest.region.region} name={regionMeta[lowest.region.region].name} />{regionMeta[lowest.region.region].name}</> : "当前套餐可比地区不足"}</small>
              </div>
              <ol className="share-card-ranking">
                {ranked.slice(0, 3).map((row, index) => {
                  const meta = regionMeta[row.region.region];
                  return <li key={row.region.region}><span>{index + 1} · <RegionFlag code={row.region.region} name={meta.name} />{meta.name}</span><b>{row.item?.price}</b><em>¥{row.cny?.toFixed(2)}</em></li>;
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
