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
import { type AppType, createApp } from './index'
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
}

// Wrap the fetch handler so Sentry (#361) gets per-request async context and
// auto-captures anything that escapes the handler. `resolveSentryOptions` gates
// it off (enabled: false) when no SENTRY_DSN is present, so local/CI/unset
// deploys send nothing.
export default Sentry.withSentry((env: SentryRuntimeEnv) => resolveSentryOptions(env), handler)
