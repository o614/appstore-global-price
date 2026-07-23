"use client";

import { useState } from "react";
import { ShareForwardLine } from "@mingcute/react";

const shareTitle = "App Store 全球价格";
const shareText = "比较热门 App 与 Apple 订阅服务在 20 个地区的官方价格，查看同一套餐在哪个地区更便宜。";

export function SiteShareButton() {
  const [feedback, setFeedback] = useState("");

  async function shareSite() {
    const url = new URL("/", window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setFeedback("网站链接已复制");
      window.setTimeout(() => setFeedback(""), 1800);
    } catch {
      setFeedback("复制失败，请稍后重试");
    }
  }

  return (
    <span className="site-share-control">
      <button type="button" className="site-share-button" onClick={shareSite}>
        <ShareForwardLine className="ui-icon" aria-hidden="true" />
        分享网站
      </button>
      <small role="status" aria-live="polite">{feedback}</small>
    </span>
  );
}
