"use client";

import { useSyncExternalStore } from "react";
import { History2Line } from "@mingcute/react";

type FreshnessTone = "snapshot" | "stale";

type FreshnessView = {
  tone: FreshnessTone;
  label: string;
  description: string;
};

const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

function subscribeToTimeChange(onStoreChange: () => void) {
  const interval = window.setInterval(onStoreChange, MINUTE_IN_MS);
  return () => window.clearInterval(interval);
}

function getCurrentMinute() {
  return Math.floor(Date.now() / MINUTE_IN_MS);
}

function relativeAge(ageMs: number) {
  if (ageMs < 2 * MINUTE_IN_MS) return "刚刚";
  if (ageMs < HOUR_IN_MS) return `${Math.floor(ageMs / MINUTE_IN_MS)} 分钟前`;
  if (ageMs < DAY_IN_MS) return `${Math.floor(ageMs / HOUR_IN_MS)} 小时前`;
  return `${Math.floor(ageMs / DAY_IN_MS)} 天前`;
}

export function DataFreshness({
  generatedAt,
  displayDate,
  variant = "badge",
}: {
  generatedAt: string;
  displayDate: string;
  variant?: "badge" | "inline";
}) {
  const currentMinute = useSyncExternalStore(subscribeToTimeChange, getCurrentMinute, () => -1);
  const generatedTime = Date.parse(generatedAt);
  const currentTime = currentMinute >= 0 ? currentMinute * MINUTE_IN_MS : null;
  const ageMs = currentTime !== null && Number.isFinite(generatedTime)
    ? Math.max(0, currentTime - generatedTime)
    : null;
  let view: FreshnessView = {
    tone: "snapshot",
    label: `价格快照 ${displayDate}`,
    description: `最近一次通过校验并发布的价格快照：${displayDate}。系统约每 6 小时自动检测一次。`,
  };

  if (ageMs !== null) {
    view = {
      tone: ageMs > 7 * DAY_IN_MS ? "stale" : "snapshot",
      label: `价格快照 · ${relativeAge(ageMs)}`,
      description: `最近一次通过校验并发布的价格快照：${displayDate}。系统约每 6 小时自动检测一次。`,
    };
  }

  return (
    <time
      className={`${variant === "inline" ? "freshness-inline" : "live-badge"} freshness-${view.tone}`}
      dateTime={generatedAt}
      title={view.description}
      aria-label={view.description}
    >
      <History2Line className="ui-icon freshness-icon" aria-hidden="true" />
      {view.label}
    </time>
  );
}
