"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SearchLine } from "@mingcute/react";
import type { AppSnapshot } from "../lib/catalog";
import { getAppCoverage } from "../lib/catalog";
import { discoverPlans } from "../lib/plan-discovery.mjs";
import { AppArtwork } from "./AppArtwork";
import { PriceExplorer } from "./PriceExplorer";
import { PriceShareProvider } from "./PriceShareContext";

type SearchResult = {
  appId: string;
  appName: string;
  developer: string;
  icon: string | null;
  storeUrl: string;
  sourceRegion: string;
};

type SearchPayload = {
  query: string;
  results: SearchResult[];
  error?: string;
};

type ComparePayload = {
  generatedAt: string;
  regionCount: number;
  app: AppSnapshot;
  error?: string;
};

function messageFromResponse(payload: { error?: string }, fallback: string) {
  return payload.error || fallback;
}

export function CustomAppSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [comparison, setComparison] = useState<ComparePayload | null>(null);
  const [searching, setSearching] = useState(false);
  const [comparingId, setComparingId] = useState("");
  const [error, setError] = useState("");

  const plans = useMemo(
    () => comparison ? discoverPlans(comparison.app, []) : [],
    [comparison],
  );
  const coverage = useMemo(
    () => comparison ? getAppCoverage(comparison.app) : null,
    [comparison],
  );

  async function runSearch(value: string) {
    const normalized = value.trim();
    if (normalized.length < 2) {
      setError("请输入至少 2 个字符。");
      return;
    }

    setSearching(true);
    setError("");
    setComparison(null);
    try {
      const response = await fetch(`/api/apps/search?q=${encodeURIComponent(normalized)}`, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json() as SearchPayload;
      if (!response.ok) throw new Error(messageFromResponse(payload, "搜索暂时不可用"));
      setResults(payload.results);
      if (!payload.results.length) setError("没有找到匹配应用，可尝试输入 App ID 或完整 App Store 链接。");
      const url = new URL(window.location.href);
      url.searchParams.set("q", normalized);
      window.history.replaceState(null, "", url);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "搜索暂时不可用");
    } finally {
      setSearching(false);
    }
  }

  async function compare(result: SearchResult) {
    setComparingId(result.appId);
    setError("");
    try {
      const response = await fetch(`/api/apps/compare/${result.appId}`, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json() as ComparePayload;
      if (!response.ok) throw new Error(messageFromResponse(payload, "比价暂时不可用"));
      setComparison(payload);
      window.requestAnimationFrame(() => {
        document.getElementById("custom-comparison")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (compareError) {
      setComparison(null);
      setError(compareError instanceof Error ? compareError.message : "比价暂时不可用");
    } finally {
      setComparingId("");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const initialQuery = new URL(window.location.href).searchParams.get("q")?.trim() ?? "";
      if (!initialQuery) return;
      setQuery(initialQuery);
      void runSearch(initialQuery);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="custom-search-workspace" aria-label="自定义应用比价">
      <div className="custom-search-panel">
        <form className="custom-search-form" onSubmit={submit}>
          <label>
            <SearchLine className="ui-icon" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="应用名称、App ID 或 App Store 链接"
              autoComplete="off"
              enterKeyHint="search"
              aria-label="搜索 App"
            />
          </label>
          <button type="submit" disabled={searching}>
            {searching ? "正在搜索…" : "搜索"}
          </button>
        </form>
      </div>

      {error && <p className="custom-search-error" role="status">{error}</p>}

      {!!results.length && !comparison && (
        <div className="custom-search-results" aria-label="应用搜索结果">
          {results.map((result) => (
            <button
              key={result.appId}
              type="button"
              className="custom-search-result"
              onClick={() => void compare(result)}
              disabled={Boolean(comparingId)}
            >
              <AppArtwork
                app={{
                  id: result.appId,
                  query: result.appName,
                  matchedName: result.appName,
                  developer: result.developer,
                  icon: result.icon ?? undefined,
                  regions: [],
                }}
                className="custom-result-icon"
                size={58}
              />
              <span>
                <strong>{result.appName}</strong>
                <small>{result.developer || `App ID ${result.appId}`}</small>
              </span>
              <em>{comparingId === result.appId ? "正在比较 20 区…" : "比较"}</em>
            </button>
          ))}
        </div>
      )}

      {comparison && coverage && (
        <section className="custom-comparison" id="custom-comparison">
          <div className="custom-app-summary">
            <AppArtwork app={comparison.app} className="custom-app-icon" size={88} />
            <div>
              <span className="eyebrow">20 区临时查询</span>
              <h2>{comparison.app.matchedName}</h2>
              <p>{comparison.app.developer}</p>
              <small>
                App ID {comparison.app.id} · {coverage.verified}/{comparison.regionCount} 个地区有公开价格
                {coverage.review > 0 ? ` · ${coverage.review} 个地区待复核` : ""}
              </small>
            </div>
            <button type="button" onClick={() => setComparison(null)}>更换应用</button>
          </div>

          <div className="custom-comparison-heading">
            <span className="eyebrow">订阅比价</span>
            <h2>选择套餐，查看各地区价格</h2>
          </div>
          <PriceShareProvider>
            <PriceExplorer app={comparison.app} plans={plans} />
          </PriceShareProvider>
        </section>
      )}
    </section>
  );
}
