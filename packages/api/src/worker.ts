/**
 * CF Workers entry point. Split from index.ts so that importing `@kuruma/api`
 * for types (e.g. `type AppType` in the web client) does NOT construct the
 * full app and pay the Drizzle repo / service wiring cost (#334).
 *
 * The app is memoised per-isolate. Each CF Workers isolate cold-starts once
 * then handles many requests; constructing lazily means the first request
 * pays the init cost but we never run `createApp()` at module load, which
 * is the rule CLAUDE.md calls out for CF Workers (#327).
 */

import * as Sentry from '@sentry/cloudflare'
import {
  type AppType,
  buildCancellationRefundReconciler,
  buildComplianceDigestService,
  buildNotificationRetryService,
  buildReviewRevealSweep,
  createApp,
} from './index'
import { type SentryRuntimeEnv, resolveSentryOptions } from './observability/sentry-options'

let cachedApp: AppType | null = null

function getApp(): AppType {
  if (!cachedApp) {
    cachedApp = createApp()
  }
  return cachedApp
}

const handler = {
  fetch(request: Request, env?: unknown, ctx?: ExecutionContext): Response | Promise<Response> {
    return getApp().fetch(request, env, ctx)
  },
  // Daily cron (crons = ["0 23 * * *"]) on the SAME handler object so Sentry's
  // withSentry instruments it and it shares the per-isolate async context. Each
  // builder composes a fresh service from the env-resolved repos — the same
  // source routes resolve through. Four independent jobs: the #916 §5.4 compliance
  // digest, the #851 refund-on-cancellation reconciler, the #1125 notification
  // retry sweep, and the #1067 review-reveal sweep backstops.
  async scheduled(
    _controller: ScheduledController,
    _env?: unknown,
    _ctx?: ExecutionContext,
  ): Promise<void> {
    // No cross-run lock: a daily cron can't overlap itself, and every run() is
    // idempotent. The jobs are isolated — one throwing must not starve the others
    // (a digest failure can't silence the money backstop or the notification sweep,
    // or vice versa) — and any failures are re-thrown together so withSentry still
    // captures them.
    const errors: unknown[] = []
    for (const job of [
      { name: 'compliance-digest', run: () => buildComplianceDigestService().run() },
      { name: 'refund-reconciler', run: () => buildCancellationRefundReconciler().run() },
      { name: 'notification-retry', run: () => buildNotificationRetryService().run() },
      { name: 'review-reveal-sweep', run: () => buildReviewRevealSweep().run() },
    ]) {
      try {
        const summary = await job.run()
        console.info(`[cron:${job.name}]`, JSON.stringify(summary))
      } catch (err) {
        console.error(`[cron:${job.name}] failed`, err)
        errors.push(err)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'scheduled cron job(s) failed')
  },
}

// Wrap the fetch handler so Sentry (#361) gets per-request async context and
// auto-captures anything that escapes the handler. `resolveSentryOptions` gates
// it off (enabled: false) when no SENTRY_DSN is present, so local/CI/unset
// deploys send nothing.
export default Sentry.withSentry((env: SentryRuntimeEnv) => resolveSentryOptions(env), handler)
