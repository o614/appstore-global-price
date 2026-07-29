import assert from "node:assert/strict";
import test from "node:test";
import { detectClientKind } from "../app/lib/client-kind.mjs";

test("detects WeChat before the underlying device", () => {
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) MicroMessenger/8.0.50",
    platform: "iPhone",
    maxTouchPoints: 5,
  }), "wechat");
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 MicroMessenger/8.0.50",
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }), "wechat");
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 wxwork/4.1.31",
    platform: "Win32",
  }), "wechat");
});

test("detects iOS, iPad desktop mode, and other browsers", () => {
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
  }), "ios");
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  }), "ios");
  assert.equal(detectClientKind({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0",
    platform: "Win32",
  }), "other");
});
