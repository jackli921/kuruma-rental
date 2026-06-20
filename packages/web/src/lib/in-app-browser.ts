/**
 * Detect embedded / in-app webviews (WeChat, LINE, Facebook, …). Google OAuth
 * refuses sign-in from these with `403 disallowed_useragent`, so the auth pages
 * show a "open in your real browser" notice when this returns true (#992).
 *
 * Deliberately conservative: we match app-specific tokens (and the Android
 * System WebView `; wv)` marker) rather than trying to infer iOS WKWebView from
 * the absence of `Safari` — that heuristic mis-flags legitimate browsers. WeChat
 * (`MicroMessenger`), the real beta blocker, is matched unambiguously.
 */
const IN_APP_BROWSER_MARKERS: readonly RegExp[] = [
  /MicroMessenger/i, // WeChat
  /\bWeibo\b/i, // Sina Weibo
  /\bQQ\/[\d.]+/i, // QQ in-app (not the standalone MQQBrowser)
  /\bLine\//i, // LINE
  /FBAN|FBAV|FB_IAB/i, // Facebook
  /Instagram/i, // Instagram
  /\bTikTok\b|BytedanceWebview|musical_ly/i, // TikTok / Douyin
  /\bKAKAOTALK\b/i, // KakaoTalk
  /Snapchat/i, // Snapchat
  /;\s*wv\)/i, // generic Android System WebView
]

export function isInAppBrowser(userAgent: string): boolean {
  if (!userAgent) return false
  return IN_APP_BROWSER_MARKERS.some((marker) => marker.test(userAgent))
}
