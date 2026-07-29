"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CloseLine,
  InformationLine,
  LinkLine,
  PicLine,
  WarningLine,
} from "@mingcute/react";
import {
  dataUpdatedAt,
  findPlanItem,
  getPriceSourceCopy,
  getRegionEvidenceState,
  getRegionPriceSourceUrl,
  getRegionStoreUrl,
  getRegionSwitchUrl,
  regionMeta,
  toCny,
  type AppSnapshot,
  type PlanDefinition,
} from "../lib/catalog";
import { detectClientKind, type ClientKind } from "../lib/client-kind.mjs";
import { AppArtwork } from "./AppArtwork";
import { BrandMark } from "./BrandMark";
import { usePriceShare } from "./PriceShareContext";
import { RegionFlag } from "./RegionFlag";

const CANVAS_FONT_STACK = '"PingFang SC", "PingFang TC", "PingFang HK", -apple-system, BlinkMacSystemFont, sans-serif';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fitCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to create share image"));
    }, "image/png");
  });
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}

async function loadRemoteCanvasImage(src: string) {
  const response = await fetch(src, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`Unable to load ${src}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = await loadCanvasImage(objectUrl);
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function PriceExplorer({ app, plans }: { app: AppSnapshot; plans: PlanDefinition[] }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const { isShareOpen, closeShare } = usePriceShare();
  const [selectedStoreRegion, setSelectedStoreRegion] = useState<string | null>(null);
  const [clientKind, setClientKind] = useState<"unknown" | ClientKind>("unknown");
  const [shareFeedback, setShareFeedback] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? plans[0];
  const sourceCopy = getPriceSourceCopy(app);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const planId = new URL(window.location.href).searchParams.get("plan");
      if (planId && plans.some((plan) => plan.id === planId)) setSelectedId(planId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [plans]);

  useEffect(() => {
    if (!isShareOpen && !selectedStoreRegion) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeShare();
        setSelectedStoreRegion(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeShare, isShareOpen, selectedStoreRegion]);

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

  async function shareImage() {
    setShareFeedback("正在生成图片…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");

      const gradient = context.createLinearGradient(0, 0, 1080, 1350);
      gradient.addColorStop(0, "#f7f8fa");
      gradient.addColorStop(1, "#eef2f7");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.shadowColor = "rgba(31, 42, 55, 0.12)";
      context.shadowBlur = 42;
      context.shadowOffsetY = 18;
      context.fillStyle = "#ffffff";
      roundedRect(context, 64, 64, 952, 1222, 48);
      context.fill();
      context.shadowColor = "transparent";
      context.shadowBlur = 0;
      context.shadowOffsetY = 0;

      try {
        const brandIcon = await loadCanvasImage("/icon.svg");
        context.drawImage(brandIcon, 112, 112, 92, 92);
      } catch {
        context.fillStyle = "#ffe60f";
        roundedRect(context, 112, 112, 92, 92, 23);
        context.fill();
      }

      context.fillStyle = "#18181b";
      context.font = `600 36px ${CANVAS_FONT_STACK}`;
      context.fillText("App Store 订阅比价", 228, 157);
      context.fillStyle = "#77777d";
      context.font = `400 24px ${CANVAS_FONT_STACK}`;
      context.fillText("比较 20 个地区的 Apple 官方价格", 228, 195);

      context.strokeStyle = "#e7e7eb";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(112, 246);
      context.lineTo(968, 246);
      context.stroke();

      context.fillStyle = "#77777d";
      context.font = `500 24px ${CANVAS_FONT_STACK}`;
      context.fillText("当前比价", 112, 312);
      context.fillStyle = "#18181b";
      context.font = `650 52px ${CANVAS_FONT_STACK}`;
      context.fillText(fitCanvasText(context, app.matchedName, 856), 112, 378);
      context.fillStyle = "#55555b";
      context.font = `500 30px ${CANVAS_FONT_STACK}`;
      context.fillText(fitCanvasText(context, `${selectedPlan.label} · ${selectedPlan.period}`, 856), 112, 428);

      context.fillStyle = "#f1f7ff";
      roundedRect(context, 112, 482, 856, 236, 34);
      context.fill();
      context.fillStyle = "#68717c";
      context.font = `500 24px ${CANVAS_FONT_STACK}`;
      context.fillText("参考折算最低", 154, 545);
      context.fillStyle = "#15171a";
      context.font = `650 76px ${CANVAS_FONT_STACK}`;
      context.fillText(lowest ? `¥${lowest.cny?.toFixed(2)}` : "暂无完整数据", 154, 642);
      context.fillStyle = "#4f5965";
      context.font = `500 28px ${CANVAS_FONT_STACK}`;
      const lowestRegion = lowest ? regionMeta[lowest.region.region].name : "当前套餐可比地区不足";
      context.fillText(`${lowestRegion}${lowest ? ` · ${ranked.length} 个地区可比` : ""}`, 154, 687);

      context.fillStyle = "#77777d";
      context.font = `500 24px ${CANVAS_FONT_STACK}`;
      context.fillText("价格前三", 112, 786);

      ranked.slice(0, 3).forEach((row, index) => {
        const meta = regionMeta[row.region.region];
        const top = 822 + index * 102;
        context.fillStyle = "#f7f7f9";
        roundedRect(context, 112, top, 856, 92, 22);
        context.fill();
        context.fillStyle = index === 0 ? "#dceeff" : "#e9e9ed";
        context.beginPath();
        context.arc(142, top + 39, 24, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = index === 0 ? "#0071e3" : "#606066";
        context.font = `600 23px ${CANVAS_FONT_STACK}`;
        context.textAlign = "center";
        context.fillText(String(index + 1), 142, top + 48);
        context.textAlign = "left";
        context.fillStyle = "#202024";
        context.font = `600 31px ${CANVAS_FONT_STACK}`;
        context.fillText(meta.name, 188, top + 35);
        context.fillStyle = "#77777d";
        context.font = `500 23px ${CANVAS_FONT_STACK}`;
        context.fillText(`${row.item?.price} ${meta.currency}`, 188, top + 69);
        context.fillStyle = "#202024";
        context.font = `600 32px ${CANVAS_FONT_STACK}`;
        context.textAlign = "right";
        context.fillText(`¥${row.cny?.toFixed(2)}`, 930, top + 54);
        context.textAlign = "left";
      });

      context.strokeStyle = "#e7e7eb";
      context.beginPath();
      context.moveTo(112, 1128);
      context.lineTo(968, 1128);
      context.stroke();

      try {
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(getShareUrl())}&size=260&margin=1&ecLevel=M&format=png`;
        const { image: qrImage, objectUrl } = await loadRemoteCanvasImage(qrUrl);
        try {
          context.fillStyle = "#ffffff";
          roundedRect(context, 816, 1140, 144, 144, 18);
          context.fill();
          context.drawImage(qrImage, 824, 1148, 128, 128);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        // QR generation is optional; a temporary third-party outage must not block image sharing.
      }

      context.fillStyle = "#74747a";
      context.font = `400 22px ${CANVAS_FONT_STACK}`;
      context.fillText(`价格快照 ${dataUpdatedAt}`, 112, 1194);
      context.font = `400 20px ${CANVAS_FONT_STACK}`;
      context.fillText("人民币金额仅供参考", 112, 1238);
      context.textAlign = "left";

      const blob = await canvasToBlob(canvas);
      const fileName = `${app.matchedName}-${selectedPlan.label}-订阅比价.png`.replace(/[\\/:*?"<>|]/g, "-");
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: `${app.matchedName} 订阅比价`,
            text: `${selectedPlan.label}（${selectedPlan.period}）价格对比`,
            files: [file],
          });
          setShareFeedback("图片已生成");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setShareFeedback("");
            return;
          }
        }
      }

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setShareFeedback("图片已生成并下载");
    } catch {
      setShareFeedback("图片生成失败，请稍后重试");
    }
  }

  function showStoreOptions(regionCode: string) {
    setShareFeedback("");
    setClientKind(detectClientKind({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
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
        <span className="no-iap-mark"><InformationLine className="ui-icon" aria-hidden="true" /></span>
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
                    ? <a className="region-name region-store-link" href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开${meta.name}官方价格页`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}</span></a>
                    : <button className="region-name region-store-link" type="button" onClick={() => showStoreOptions(row.region.region)} aria-label={`打开${meta.name}区 App Store`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}</span></button>}</td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="original-price col-original">{row.item?.price} <small>{meta.currency}</small></td>
                  <td className="cny-price col-cny">¥{row.cny?.toFixed(2)}</td>
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
              const statusClass = evidenceState === "review" ? "review-pill" : evidenceState === "not-public" ? "not-public-pill" : "unavailable-pill";
              return (
                <tr className="muted-row" key={row.region.region}>
                  <td className="col-rank">—</td>
                  <td className="col-region">{canOpenStore ? (app.priceSource !== "app-store"
                    ? <a className="region-name region-store-link" href={sourceUrl ?? undefined} target="_blank" rel="noreferrer" aria-label={`打开${meta.name}官方价格页`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}</span></a>
                    : <button className="region-name region-store-link" type="button" onClick={() => showStoreOptions(row.region.region)} aria-label={`打开${meta.name}区 App Store`}><RegionFlag code={row.region.region} name={meta.name} size="regular" /><span>{meta.name}</span></button>) : <span className="region-name"><RegionFlag code={row.region.region} name={meta.name} size="regular" />{meta.name}</span>}</td>
                  <td className="col-items"><span className="store-count">{row.region.itemCount} 项</span></td>
                  <td className="col-original muted-detail">{detail}</td>
                  <td className="col-cny"><span className={statusClass}>{shortStatus}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedStoreRegion && (() => {
        const meta = regionMeta[selectedStoreRegion];
        const switchUrl = getRegionSwitchUrl(selectedStoreRegion);
        const webUrl = getRegionStoreUrl(app.id, selectedStoreRegion, app.regionalAppIds);
        return (
          <div className="share-dialog-backdrop" onMouseDown={() => setSelectedStoreRegion(null)}>
            <section className="share-dialog store-jump-dialog" role="dialog" aria-modal="true" aria-labelledby="store-jump-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="share-dialog-header">
                <div>
                  <span>打开地区商店</span>
                  <h2 id="store-jump-title"><RegionFlag code={selectedStoreRegion} name={meta.name} size="regular" />{meta.name}区 App Store</h2>
                </div>
                <button type="button" className="share-dialog-close" onClick={() => setSelectedStoreRegion(null)} aria-label="关闭跳转提示"><CloseLine className="ui-icon" aria-hidden="true" /></button>
              </div>

              <div className="store-account-warning">
                <WarningLine className="ui-icon" aria-hidden="true" />
                <div>
                  <strong>请先准备对应地区的 Apple ID</strong>
                  <p>安装应用或订阅套餐前，需要登录可用的{meta.name}区 Apple ID。</p>
                </div>
              </div>

              {clientKind === "wechat" ? (
                <div className="store-device-panel">
                  <div className="store-wechat-guide" role="note">
                    <InformationLine className="ui-icon" aria-hidden="true" />
                    <div>
                      <strong>请在浏览器中打开</strong>
                      <p>点击微信右上角 ···，选择“在浏览器中打开”后再继续。</p>
                    </div>
                  </div>
                </div>
              ) : clientKind === "ios" ? (
                <div className="store-device-panel">
                  <div className="store-jump-actions single">
                    {switchUrl && <button className="store-jump-primary" type="button" onClick={() => copyAppNameAndSwitch(switchUrl)}><strong>复制 {app.query} 并切换到{meta.name}区</strong><small>切换完成后在 App Store 粘贴搜索</small></button>}
                  </div>
                </div>
              ) : clientKind === "other" ? (
                <div className="store-device-panel">
                  <div className="store-jump-actions single">
                    <button className="store-jump-primary" type="button" onClick={() => copyText(webUrl, "应用链接已复制")}><LinkLine className="ui-icon" aria-hidden="true" />复制应用链接</button>
                  </div>
                </div>
              ) : (
                <div className="store-device-panel"><p>正在识别当前设备…</p></div>
              )}

              <div className="share-feedback" role="status" aria-live="polite">{shareFeedback}</div>
            </section>
          </div>
        );
      })()}

      {isShareOpen && (
        <div className="share-dialog-backdrop" onMouseDown={closeShare}>
          <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="share-dialog-header">
              <div>
                <span>分享当前结果</span>
                <h2 id="share-dialog-title">把这一组价格发给朋友</h2>
              </div>
              <button type="button" className="share-dialog-close" onClick={closeShare} aria-label="关闭分享弹窗"><CloseLine className="ui-icon" aria-hidden="true" /></button>
            </div>

            <div className="share-result-card">
              <div className="share-card-brand"><BrandMark /><small>App Store 订阅比价</small></div>
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

            <p className="share-dialog-note"><InformationLine className="ui-icon" aria-hidden="true" />分享内容会保留当前套餐和周期；人民币为汇率参考，实际扣款以对应地区 App Store 为准。</p>
            <div className="share-dialog-actions">
              <button type="button" className="share-primary" onClick={shareImage}><PicLine className="ui-icon" aria-hidden="true" />分享图片</button>
              <button type="button" onClick={() => copyText(getShareUrl(), "链接已复制")}><LinkLine className="ui-icon" aria-hidden="true" />复制链接</button>
            </div>
            <div className="share-feedback" role="status" aria-live="polite">{shareFeedback}</div>
          </section>
        </div>
      )}
    </div>
  );
}
