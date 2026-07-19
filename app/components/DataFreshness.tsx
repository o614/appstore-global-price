"use client";

import { useSyncExternalStore } from "react";

type FreshnessTone = "snapshot" | "fresh" | "aging" | "stale";

type FreshnessView = {
  tone: FreshnessTone;
  label: string;
  description: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function subscribeToDayChange(onStoreChange: () => void) {
  const interval = window.setInterval(onStoreChange, 60 * 60 * 1000);
  return () => window.clearInterval(interval);
}

function getCurrentDay() {
  return Math.floor(Date.now() / DAY_IN_MS);
}

export function DataFreshness({ generatedAt, displayDate }: { generatedAt: string; displayDate: string }) {
  const currentDay = useSyncExternalStore(subscribeToDayChange, getCurrentDay, () => -1);
  const generatedTime = Date.parse(generatedAt);
  const generatedDay = Number.isFinite(generatedTime) ? Math.floor(generatedTime / DAY_IN_MS) : null;
  const ageDays = currentDay >= 0 && generatedDay !== null ? Math.max(0, currentDay - generatedDay) : null;
  let view: FreshnessView = {
    tone: "snapshot",
    label: `Apple 快照 ${displayDate}`,
    description: `Apple 价格更新于 ${displayDate}`,
  };

  if (ageDays === 0) {
    view = {
      tone: "fresh",
      label: `今日已更新 ${displayDate}`,
      description: `Apple 价格已于今日更新，日期 ${displayDate}`,
    };
  } else if (ageDays !== null && ageDays <= 2) {
    view = {
      tone: "fresh",
      label: `${ageDays} 天前更新`,
      description: `Apple 价格更新于 ${displayDate}，距今 ${ageDays} 天`,
    };
  } else if (ageDays !== null && ageDays <= 7) {
    view = {
      tone: "aging",
      label: `数据 ${ageDays} 天前`,
      description: `Apple 价格更新于 ${displayDate}，建议购买前重新核对`,
    };
  } else if (ageDays !== null) {
    view = {
      tone: "stale",
      label: `数据待更新 · ${ageDays} 天`,
      description: `Apple 价格更新于 ${displayDate}，已超过 7 天，建议购买前重新核对`,
    };
  }

  return (
    <time
      className={`live-badge freshness-${view.tone}`}
      dateTime={generatedAt}
      title={view.description}
      aria-label={view.description}
    >
      <i aria-hidden="true" />
      {view.label}
    </time>
  );
}
