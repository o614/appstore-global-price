"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SearchLine } from "@mingcute/react";
import type { AppSnapshot } from "../lib/catalog";
import { discoverPlans } from "../lib/plan-discovery.mjs";
import { AppComparisonView } from "./AppComparisonView";
import { AppArtwork } from "./AppArtwork";

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

async function searchRequest(query: string): Promise<SearchPayload> {
  const endpoint = `/api/apps/search?v=3&q=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({})) as Partial<SearchPayload>;
      if (response.ok && Array.isArray(payload.results)) return payload as SearchPayload;
      if (response.status === 429) throw new Error("搜索请求较多，请稍等片刻再试。");
      if (response.status >= 500 && attempt === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        continue;
      }
      throw new Error(messageFromResponse(payload, "搜索暂时不可用，请稍后重试。"));
    } catch (requestError) {
      if (attempt === 0 && !(requestError instanceof Error && requestError.message.includes("请求较多"))) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        continue;
      }
      if (requestError instanceof Error && requestError.message) throw requestError;
      throw new Error("网络连接不稳定，请稍后重试。");
    }
  }
  throw new Error("搜索暂时不可用，请稍后重试。");
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
  const comparisonDisplayDate = useMemo(() => {
    if (!comparison) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(comparison.generatedAt));
  }, [comparison]);

  async function runSearch(value: string) {
    const normalized = value.trim();
    if (normalized.length < 2) {
      setError("请输入至少 2 个字符。");
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("q", normalized);
    url.searchParams.delete("app");
    url.searchParams.delete("plan");
    url.hash = "";
    window.history.replaceState(null, "", url);

    setSearching(true);
    setError("");
    setComparison(null);
    try {
      const payload = await searchRequest(normalized);
      setResults(payload.results);
      if (!payload.results.length) setError("没有找到匹配应用，可尝试输入 App ID 或完整 App Store 链接。");
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "搜索暂时不可用");
    } finally {
      setSearching(false);
    }
  }

  async function compare(appId: string) {
    setComparingId(appId);
    setError("");
    try {
      const response = await fetch(`/api/apps/compare/${appId}`, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json() as ComparePayload;
      if (!response.ok) throw new Error(messageFromResponse(payload, "比价暂时不可用"));

      const url = new URL(window.location.href);
      url.searchParams.set("q", payload.app.matchedName);
      url.searchParams.set("app", appId);
      window.history.replaceState(null, "", url);

      setQuery(payload.app.matchedName);
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
      const url = new URL(window.location.href);
      const initialQuery = url.searchParams.get("q")?.trim() ?? "";
      const initialAppId = url.searchParams.get("app")?.trim() ?? "";
      if (initialQuery) setQuery(initialQuery);
      if (/^\d{5,}$/.test(initialAppId)) {
        void compare(initialAppId);
      } else if (initialQuery) {
        void runSearch(initialQuery);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <section
        className={`custom-search-workspace${comparison ? " has-comparison" : ""}`}
        aria-label="自定义应用比价"
      >
        <div className="custom-search-panel">
          <form className="custom-search-form" onSubmit={submit} aria-busy={searching}>
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
              {searching && <span className="search-spinner" aria-hidden="true" />}
              <span>{searching ? "正在搜索" : "搜索"}</span>
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
                onClick={() => void compare(result.appId)}
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
                <em>
                  {comparingId === result.appId && <span className="search-spinner search-spinner-blue" aria-hidden="true" />}
                  <span>{comparingId === result.appId ? "正在比价" : "比价"}</span>
                </em>
              </button>
            ))}
          </div>
        )}
      </section>

      {comparison && (
        <section className="custom-comparison detail-page" id="custom-comparison">
          <AppComparisonView
            app={comparison.app}
            plans={plans}
            generatedAt={comparison.generatedAt}
            displayDate={comparisonDisplayDate}
          />
        </section>
      )}
    </>
  );
}
