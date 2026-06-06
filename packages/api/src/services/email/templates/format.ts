// Pure formatting helpers shared by the email renderers (FC/IS: pure core).

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape user/operator-supplied strings before interpolating into email HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/** Whole-yen amount with thousands separators, e.g. 2000 -> "¥2,000". */
export function formatJpy(amountJpy: number): string {
  return `¥${new Intl.NumberFormat('en-US').format(amountJpy)}`
}

/** Deterministic UTC datetime (no host-timezone surprises): "2026-07-01 10:00 UTC". */
export function formatDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
