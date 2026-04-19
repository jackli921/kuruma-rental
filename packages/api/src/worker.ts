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

import { type AppType, createApp } from './index'

let cachedApp: AppType | null = null

function getApp(): AppType {
  if (!cachedApp) {
    cachedApp = createApp()
  }
  return cachedApp
}

export default {
  fetch(request: Request, env?: unknown, ctx?: ExecutionContext): Response | Promise<Response> {
    return getApp().fetch(request, env, ctx)
  },
}
