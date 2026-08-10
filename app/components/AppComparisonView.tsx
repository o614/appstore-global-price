"use client";

import {
  AlertLine,
  CheckCircleLine,
  Earth2Line,
  ListCheckLine,
  Numbers09SortAscendingLine,
} from "@mingcute/react";
import {
  getAppCoverage,
  getPriceSourceCopy,
  getVerifiedRegionCount,
  rateAttributionUrl,
  rateProvider,
  type AppSnapshot,
  type PlanDefinition,
} from "../lib/catalog";
import { AppArtwork } from "./AppArtwork";
import { DataFreshness } from "./DataFreshness";
import { PriceExplorer } from "./PriceExplorer";
import { PriceShareProvider } from "./PriceShareContext";
import { PriceShareTrigger } from "./PriceShareTrigger";

export function AppComparisonView({
  app,
  plans,
  generatedAt,
  displayDate,
  priority = false,
}: {
  app: AppSnapshot;
  plans: PlanDefinition[];
  generatedAt: string;
  displayDate: string;
  priority?: boolean;
}) {
  const verifiedCount = getVerifiedRegionCount(app);
  const coverage = getAppCoverage(app);
  const sourceCopy = getPriceSourceCopy(app);

  return (
    <>
      <PriceShareProvider>
        <section className="app-hero">
          <AppArtwork app={app} alt={`${app.matchedName} 图标`} className="app-hero-icon" size={104} priority={priority} />
          <div className="app-hero-copy">
            <div className="app-title-row"><h1>{app.matchedName}</h1></div>
            <p>{app.developer}</p>
            <div className="detail-badges">
              <span className="detail-meta-badge detail-id-badge"><Numbers09SortAscendingLine className="ui-icon" aria-hidden="true" />{app.priceSource === "app-store" || !app.priceSource ? "App ID" : "服务 ID"} <b>{app.id}</b></span>
              <span className="detail-meta-badge"><Earth2Line className="ui-icon" aria-hidden="true" />{verifiedCount}/{app.regions.length} 地区有价格</span>
              {plans.length > 0 && <span className="detail-meta-badge"><ListCheckLine className="ui-icon" aria-hidden="true" />{plans.length} 个购买项目</span>}
              {coverage.review > 0 && <span className="detail-meta-badge review-badge"><AlertLine className="ui-icon" aria-hidden="true" />{coverage.review} 地区待复核</span>}
              <DataFreshness generatedAt={generatedAt} displayDate={displayDate} />
            </div>
          </div>
          <PriceShareTrigger disabled={plans.length === 0} />
        </section>

        <section className="comparison-section" id="comparison">
          <div className="section-heading detail-section-heading">
            <div><span className="eyebrow">订阅比价</span><h2>选择套餐，查看各地区价格</h2></div>
            <span className="truth-note"><CheckCircleLine className="ui-icon" aria-hidden="true" />同套餐、同周期比较</span>
          </div>
          <PriceExplorer key={app.id} app={app} plans={plans} />
        </section>
      </PriceShareProvider>

      <section className="detail-notes">
        <article><span>Apple 标价</span><p>原币金额来自对应地区的{sourceCopy.noun}。</p></article>
        <article><span>人民币参考</span><p>按公开汇率折算，由 <a href={rateAttributionUrl}>{rateProvider}</a> 提供。</p></article>
        <article><span>套餐比较</span><p>月付、年付和一次性购买分别排名；缺少该套餐的地区不参与比较。</p></article>
      </section>
    </>
  );
}
