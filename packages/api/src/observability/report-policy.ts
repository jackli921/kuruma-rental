/**
 * Pure decision for what the observability middleware should report to Sentry
 * (#361). Kept side-effect-free so the policy is exhaustively testable; the
 * middleware shell just calls Sentry with whatever this returns.
 */

/** Requests slower than this are reported as a performance warning (#361 AC). */
export const SLOW_REQUEST_THRESHOLD_MS = 2000

export type MonitoringDecision =
  | { report: false }
  | { report: true; reason: 'server_error'; level: 'error' }
  | { report: true; reason: 'slow_request'; level: 'warning' }

export interface RequestOutcome {
  status: number
  durationMs: number
  /**
   * True when the response came from a thrown error that the `onError` hook
   * already captured (with a stack). We skip re-reporting those as a generic
   * server_error so a single failure is one Sentry event, not two.
   */
  hadUnhandledError: boolean
  slowThresholdMs?: number
}

export function classifyRequest(outcome: RequestOutcome): MonitoringDecision {
  const threshold = outcome.slowThresholdMs ?? SLOW_REQUEST_THRESHOLD_MS
  if (outcome.status >= 500 && !outcome.hadUnhandledError) {
    return { report: true, reason: 'server_error', level: 'error' }
  }
  if (outcome.durationMs > threshold) {
    return { report: true, reason: 'slow_request', level: 'warning' }
  }
  return { report: false }
}
