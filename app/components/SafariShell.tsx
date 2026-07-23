"use client";

import { useEffect } from "react";

export function SafariShell() {
  useEffect(() => {
    const userAgent = navigator.userAgent;
    const isSafari = /Safari/i.test(userAgent)
      && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android)/i.test(userAgent);
    if (!isSafari) return;
    document.documentElement.dataset.browser = "safari";
    return () => {
      delete document.documentElement.dataset.browser;
    };
  }, []);

  return null;
}
