export function detectClientKind({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
} = {}) {
  if (/MicroMessenger|wxwork/i.test(userAgent)) return "wechat";

  const isiPadDesktopMode = platform === "MacIntel" && maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(userAgent) || isiPadDesktopMode ? "ios" : "other";
}
