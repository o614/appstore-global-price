export type ClientKind = "wechat" | "ios" | "other";

export function detectClientKind(options?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}): ClientKind;
