# #361 — Error + Uptime Monitoring: Finish & Activate

**Status:** design (2026-06-17) · **Issue:** #361 (P1, infra) · **Author:** session

## TL;DR

The Sentry instrumentation is **already built and unit-tested on both surfaces**
and is dormant (gated off when no DSN is set) — the same "built-but-OFF" pattern
as Stripe. This is **not a greenfield build**. The remaining work to make #361
deliver value is a small CI/doc finishing slice plus a HITL activation runbook.

## What already exists (verified)

| Surface | Code | Gate | Release tag |
|---|---|---|---|
| API (Workers) | `packages/api/src/observability/` (`worker.ts` `Sentry.withSentry`, `middleware.ts`, pure `report-policy.ts` + `sentry-options.ts`, all tested) | `enabled:false` until `SENTRY_DSN` | ✅ `CF_VERSION_METADATA.id` (wrangler.toml `[version_metadata]`) |
| Web (Pages SPA, #765) | `packages/web/src/lib/observability/` (`sentry.tsx` boundary + `captureRouteError`, pure `sentry-options.ts`, tested) + `main.tsx` wiring | `enabled:false` until `VITE_SENTRY_DSN` | ⚠️ reads `VITE_SENTRY_RELEASE` but **CI never injects it** |

Captured today (once a DSN is live): unhandled exceptions w/ stack
(`error-handlers.ts` → `Sentry.captureException`), raw ≥500 responses and >2s
slow requests (`report-policy.ts`), React render crashes + TanStack route
errors. Health endpoint `GET /health` exists (`routes/health.ts`, smoke-tested
in deploy.yml). PII off by default (`sendDefaultPii:false`), traces off
(`tracesSampleRate:0`) — both deliberate per the issue's out-of-scope list.

## Gaps (the actual #361 remaining work)

### Part A — Code/CI (TDD where logic exists; mostly CI + docs)

1. **Web release injection (CI).** Add to the deploy.yml *Build web* step env
   (`deploy.yml:106`): `VITE_SENTRY_RELEASE: ${{ github.sha }}` so web errors
   group per release. The consumer (`resolveBrowserSentryOptions`) is already
   unit-tested — no app code changes.
   - **Precondition:** that build only reaches production through the *Deploy web
     to CF Pages* step (`deploy.yml:135`), which is gated behind the
     `WEB_PAGES_DEPLOY_ENABLED == 'true'` repo variable. Verify it is `true`
     (beta web is live on Pages, so it should be) before assuming the injected
     env ships — a green build with the gate off deploys nothing.
   - The duplicate *Build web* in `ci.yml:62` is **test-only** (typecheck +
     `lint:dist-size`); it never deploys, so it needs no injection.
2. **DSN secret wiring (CI).** In `rotate-secrets.yml`:
   - API: `echo "${{ secrets.SENTRY_DSN }}" | npx wrangler secret put SENTRY_DSN`
     (optional `SENTRY_ENVIRONMENT`). Runtime secret on the Worker.
   - Web: the browser DSN is **public** (ships in the bundle) — add
     `VITE_SENTRY_DSN` + `VITE_SENTRY_ENVIRONMENT` to the deploy.yml *Build web*
     step env from GitHub secrets (build-time, not a Worker secret).
   - **Do NOT add to deploy.yml's presence check yet** — mirror the Stripe
     decision (rotate-secrets.yml comment): the gateways no-op when absent, so a
     presence check would break deploys before Sentry is provisioned. Add a
     `# add to presence check once live` note.
3. **Web source-map upload (CI) — makes web traces readable.** `vite build`
   minifies, so without uploaded source maps every browser error in Sentry is
   mangled (`a.b is not a fn` at `index-4f2a.js:1:88421`) — the web half of #361
   delivers near-zero forensic value. Add `@sentry/vite-plugin` to
   `packages/web/vite.config`, keyed to `VITE_SENTRY_RELEASE`, uploading maps on
   the **deploying** build only (`deploy.yml:106`, not the `ci.yml` test build).
   Auth via a build-time `SENTRY_AUTH_TOKEN` — **a true secret, NOT a `VITE_*`
   var** (it must never ship in the bundle). The plugin no-ops without the token,
   so it stays dormant pre-activation like everything else.
4. **Fix stale RUNBOOK.** The Monitoring section (`docs/RUNBOOK.md:92`) claims
   *"Web monitoring is deferred until the Next→Vite migration settles"* — false
   now (#714 done, #765 shipped web Sentry). Rewrite to document both DSNs, the
   web release + source-map injection, and the full activation checklist below.

### Part B — Uptime monitor (decision; HITL to configure)

`/health` exists but nothing pings it. Recommendation: **Sentry Uptime Monitors**
— single pane with the error alerts, pings `GET /health`, no new code/worker.
Rejected: Cloudflare Health Checks (needs paid Load Balancing add-on); external
SaaS (second vendor); self-hosted CF Cron worker pinging `/health` (extra code +
worker — YAGNI). Keep `/health` shallow/dependency-free; a deep DB ping invites
false alarms on Neon cold starts (revisit at scale, out of scope).
**The uptime monitor catches total Worker/routing outages only** — a green ping
does not mean the DB is up. **DB-down is caught by the error alerts** (500s flow
to Sentry via `error-handlers.ts:47`), not by `/health`. Don't read a green
uptime monitor as a healthy stack.

### Part C — Alerts + dashboards (HITL, Sentry UI)

- Alert rule: **error** events spike 5× baseline over 10 min → Slack/email (issue
  AC). Page on errors only.
- **Slow-request warnings are dashboard-only, never paging.** `report-policy.ts:8`
  fires a `warning` on every request >2s, and Workers→Neon cold starts routinely
  exceed 2s (same latency the shallow-`/health` call cites). Routing these to a
  pager would be pure alert fatigue. If the dashboard noise is still high after
  activation, raise `SLOW_REQUEST_THRESHOLD_MS` (3–5s) or sample — a follow-up
  tuning change, not part of this slice.
- Dashboard: error rate by route + booking-endpoint success rate (the structured
  logger already tags path/status/requestId; release tag groups per deploy).

## Activation runbook (HITL, owner-only — one-time)

1. Create two Sentry projects: platform **Cloudflare Workers** (API) and
   **React** (web). Copy each DSN.
2. GitHub secrets: `SENTRY_DSN` (API), `VITE_SENTRY_DSN` (web),
   `SENTRY_AUTH_TOKEN` (web source-map upload), and **`SENTRY_ENVIRONMENT=beta`
   + `VITE_SENTRY_ENVIRONMENT=beta` (required, not optional)** — both
   `sentry-options.ts` files default unset → `'production'`, which would
   mis-tag beta errors as prod and pollute the env filter at real launch.
3. Run `rotate-secrets.yml` (sets the API Worker secret); next web deploy bakes
   the web DSN + release + uploads source maps.
4. In Sentry: add the alert rule (Part C) and the uptime monitor on `/health`
   (Part B).
5. Verify: trigger a test error on each surface; confirm it lands grouped under
   the deploy's release **with a readable (de-minified) web stack trace**.

## Scope / sequencing

- **This slice (code):** Part A — changes across `deploy.yml`,
  `rotate-secrets.yml`, `packages/web/vite.config` (source-map plugin), and
  `docs/RUNBOOK.md`. The only app-adjacent change is the Vite plugin; the Sentry
  instrumentation itself is done. Verification = CI green + a deploy dry-read of
  the env wiring; the plugin no-ops without `SENTRY_AUTH_TOKEN`.
- **Owner (HITL):** Parts B + C + activation runbook. Cannot be automated.
- **DoD — the PR uses `Refs #361`, NOT `Closes #361`.** Part A ships dormant and
  is safe to merge (gating is fail-off, verified in both `sentry-options.ts`),
  but #361's acceptance criteria (alert rule, uptime monitor) are Sentry-UI HITL
  actions no PR can perform. #361 stays open until the owner completes the
  runbook and verifies a test error lands on each surface.
- **Out of scope (per issue):** APM/trace waterfalls, PII scrubbing pipeline,
  deep `/health` DB check.

## Risks

- Web DSN is public by design — fine, but do not put any *secret* in a `VITE_*`
  var. Only the ingestion DSN, which Sentry intends to be client-visible.
- `rotate-secrets.yml` requires clean (no pending) Worker state — run after a
  successful deploy, per its own header.
- Don't enable `tracesSampleRate>0` casually on Workers — quota + cost; keep 0
  until we deliberately want performance traces.
- **`SENTRY_AUTH_TOKEN` is the one true secret here** (source-map upload) — keep
  it out of any `VITE_*` var so it never reaches the bundle.
- **Known limitation (accepted):** API release = CF version id, web release = git
  SHA, in two separate Sentry projects — different ID spaces, so you can't
  correlate "which web build talks to which API version" by release string. Fine
  for now; just don't expect cross-surface release joins.
