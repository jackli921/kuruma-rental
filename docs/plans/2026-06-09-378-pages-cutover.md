# Plan: #378 §7.5 — flip web deploy from opennext Worker → CF Pages (Vite)

**Date:** 2026-06-09 · **Epic:** #378 · **Spec:** `docs/superpowers/specs/2026-04-18-migrate-web-off-nextjs-design.md` §7.3–§7.5
**Base branch:** `origin/marketplace-pivot` (NEVER main) · **Worktree:** `~/Dev/kuruma-pages-cutover` · **Branch:** `feat/378-pages-cutover`
**Status:** CI/config only. **CANNOT be live-verified until #304** (CF account migration + `global_fetch_strictly_public` Pages flag).

---

## 1. Context

The Vite + TanStack migration (slice 0, #497) already shipped to marketplace-pivot:
- `vite build` → `packages/web/dist` (static SPA), gated by `lint:dist-size` (2 MiB gzip budget, currently ~10.9%).
- Same-origin proxy Functions already exist: `functions/api/[[path]].ts`, `functions/auth/[[path]].ts`, `functions/_shared/proxy.ts`. They read `API_ORIGIN` (server-side env) and forward `/api/*` (prefix stripped) and `/auth/*` (verbatim, `redirect:'manual'`) to the API Worker.
- `public/_redirects` (SPA fallback) and `public/_headers` (cache + security headers) are in place.
- Client API base = `import.meta.env.VITE_API_BASE_URL ?? '/api'` → leaving the var unset yields the same-origin `/api` proxy. **We deliberately do not set it.**

In `deploy.yml` (on marketplace-pivot) the four web-**Worker** steps (Build / Deploy / Verify secrets / Smoke) are `if: false` — the "bridge freeze (#378 §7.5)". The old Next.js Worker stays frozen at its last green build, serving production until the DNS cutover.

**This task = §7.4/§7.5 CI wiring:** add a live `wrangler pages deploy` of `packages/web/dist`, configure the Pages project (`API_ORIGIN` + compat flags), and resolve what happens to the frozen Worker steps.

### Why this is safe to merge now (de-risked)
`deploy.yml` only triggers on `workflow_run [CI]` for **`branches: [main]`** or manual `workflow_dispatch`. This PR targets **marketplace-pivot**, which is not main yet. So merging this PR runs **no deploy**. The new Pages steps stay dormant until (a) the documented marketplace-pivot→main cutover AND (b) #304 lands. We ship reviewed config, not a live deploy.

---

## 2. Scope

**In scope**
1. `package.json` (web): `pages:create-project` (compat flags, one-time) + `deploy:pages` (every deploy) scripts — the CLI source of truth (§3.1; no config file — course-correction).
2. `deploy.yml`: delete the frozen web-Worker deploy block; add live Pages steps — vite build → dist-size → `deploy:pages` (guarded) → smoke (§5).
3. A drift unit test (scripts ↔ deploy.yml ↔ vite outDir agree; compat flags present; Worker block gone) — keeps the cutover wiring from silently drifting.
4. Doc: this plan + a PR note spelling out the #304 gate and the post-merge human steps.

**Out of scope** (later slices / other issues)
- DNS flip + old Worker deletion + Next.js source deletion + dep pruning → §8 step 6 cutover, NOT now.
- Re-enabling admin/booking e2e on the Pages preview URL → #501.
- Flipping CSP Report-Only → enforcing → #500 (needs live preview).
- Any API-Worker changes (its deploy steps are untouched).

---

## 3. Design decisions

### 3.1 No Pages config file — project settings applied via CLI scripts (revised after spec-vs-tool check)

> **Course-correction (2026-06-09):** the original plan added a `wrangler.pages.jsonc` and passed `--config`. Empirically (`wrangler 4.81`): `wrangler pages deploy` has **no `--config` flag** ("Pages does not support custom paths for the Wrangler configuration file"), and it only auto-discovers a file literally named `wrangler.{toml,json,jsonc}`. Here that name is taken by the **frozen Worker** config — wrangler warns and **ignores** it. A `wrangler.pages.jsonc` is therefore never read. Making `wrangler.jsonc` the Pages config would break the Worker's `deploy`/`build:worker` scripts — that's the §8 step 6 teardown, out of scope. So: **no Pages config file.**

The Pages project's settings live in two CLI scripts (config-as-code, reproducible, drift-tested):

- **`pages:create-project`** (one-time, run at #304): `wrangler pages project create kuruma-web-pages --production-branch=production --compatibility-date=2025-04-01 --compatibility-flag=nodejs_compat --compatibility-flag=global_fetch_strictly_public`. This is where `global_fetch_strictly_public` (and `nodejs_compat`) get set for the proxy Functions — the flag #304 already calls out.
- **`deploy:pages`** (every deploy): `wrangler pages deploy dist --project-name=kuruma-web-pages --branch=production --commit-dirty=true`. Run from `packages/web` so `functions/` is compiled. No `--config`. The sibling Worker `wrangler.jsonc` is warned-and-ignored (cosmetic).
- **`API_ORIGIN`** (one-time, at #304): `echo "<api-worker-url>" | wrangler pages secret put API_ORIGIN --project-name=kuruma-web-pages` (or set as a plaintext var in the dashboard). The proxy reads `context.env.API_ORIGIN` either way. Updated to the freelance subdomain per `docs/cloudflare-account-migration.md` §6.

`packages/web/wrangler.jsonc` (Worker) is left untouched — deleted at §8 step 6, not here.

### 3.2 deploy.yml Pages steps (replace the frozen block)
```yaml
      - name: Build web (Vite → packages/web/dist)
        working-directory: packages/web
        # No VITE_API_BASE_URL → client falls back to same-origin /api proxy.
        # Placeholders mirror the CI "Build web" step; the static build bakes
        # no secret (no VITE_* references them), they only satisfy import-time reads.
        env:
          AUTH_SECRET: ci-placeholder-secret-not-real
          DATABASE_URL: postgresql://placeholder:placeholder@localhost:5432/placeholder
        run: bun run build

      - name: Check web dist size budget
        run: bun run lint:dist-size

      # Guarded: see §5.1. Unset repo var → skipped, so a pre-#304 manual
      # workflow_dispatch can't create a stray Pages project on the old account.
      - name: Deploy web to CF Pages
        if: vars.WEB_PAGES_DEPLOY_ENABLED == 'true'
        working-directory: packages/web
        run: bun run deploy:pages   # = wrangler pages deploy dist --project-name=kuruma-web-pages --branch=production --commit-dirty=true

      - name: Smoke test web (Pages)
        if: vars.WEB_PAGES_DEPLOY_ENABLED == 'true'
        run: curl -fsS --retry 10 --retry-delay 3 --retry-all-errors "$WEB_PAGES_URL/en" > /dev/null && echo "Web (Pages) landing OK"
```
- `WEB_PAGES_URL` env (workflow-level) = `https://kuruma-web-pages.pages.dev`. The old `WEB_WORKER_URL` env is **removed** with the deleted frozen block.
- `--commit-dirty=true` because CI runs on a checkout wrangler treats as dirty.
- Move the dist-size gate into deploy too (cheap, and stops an over-budget artifact from deploying even if CI was bypassed).

### 3.3 No client build-time env for the API URL
Same-origin `/api` is the whole point of the proxy (Safari ITP, spec §5.5). Setting `VITE_API_BASE_URL` would defeat it. Documented inline so nobody "helpfully" adds it.

### 3.4 First-deploy project creation
Run `bun run pages:create-project` once at #304 (sets compat flags + production branch), then `wrangler pages secret put API_ORIGIN`. `deploy:pages` then deploys into it. `wrangler pages deploy` would also auto-create a bare project, but it would lack the compat flags — so the explicit create-project step is required, not optional.

---

## 4. Files to change

| File | Change |
|------|--------|
| `.github/workflows/deploy.yml` | delete the 4-step frozen Worker deploy block; add live Pages steps (build → dist-size → deploy → smoke; deploy+smoke guarded by `WEB_PAGES_DEPLOY_ENABLED`); swap `WEB_WORKER_URL`→`WEB_PAGES_URL` env (§3.2, §5) |
| `packages/web/package.json` | add `deploy:pages` + `pages:create-project` scripts (CLI source of truth — §3.1) |
| `.github/workflows/rotate-secrets.yml` | delete the frozen web-Worker rotate block (one active path; Pages holds no rotatable secrets — review SF1) |
| `docs/cloudflare-account-migration.md` | refresh §4–§9 for the Pages reality (create-project, `API_ORIGIN`, `WEB_PAGES_DEPLOY_ENABLED`; drop the deleted `WEB_WORKER_URL`) — review SF2 |
| `packages/web/tests/deploy/wrangler-pages-config.test.ts` | **new** — drift test: scripts ↔ deploy.yml ↔ vite outDir agree; compat flags present; branch-name agreement; proxy-seam smoke; Worker block gone (11 cases) |
| `docs/plans/2026-06-09-378-pages-cutover.md` | this plan |
| PR body | #304 gate + post-merge human steps |

(No `wrangler.pages.jsonc` — see §3.1 course-correction.)

> **Drift-test scope (review NIT-4):** the test guards the *scripts and workflow text*, not the *live Pages project*. `pages:create-project` is create-only — it errors if the project already exists, and nothing re-asserts its compat flags afterward, so a flag toggled in the dashboard won't fail CI. Acceptable within wrangler 4's constraints; §8 step 2 verifies the flags live, once.

---

## 5. DECISION (resolved 2026-06-09) — delete the frozen Worker deploy block

The task prompt said "remove the if:false guards"; spec §7.4 said "keep them, delete at cutover." **Resolved: Option A — delete the frozen web-Worker deploy block now** and replace it with the live Pages steps. Reviewer-refined framing: this is **"delete the frozen Worker deploy block,"** NOT "remove the `if:false` guards" — removing only the guard would re-activate the old Worker deploy and violate the freeze. So the four steps (Build / Deploy / Verify secrets / Smoke Web Worker) are deleted wholesale, and `WEB_WORKER_URL` env is removed.

**Rationale (reviewer):** dead `if:false` deploy steps beside the live path are two truths in CI — under pressure someone toggles the wrong one and redeploys stale code. One active path; rollback is a deliberate, reviewed revert, not "uncomment the old production deploy." Git history is the recovery path.

> Learn: Config Ambiguity — disabled deploy paths beside live deploy paths create two truths in CI; eventually someone toggles the wrong one and ships stale code. Heuristic: CI shows one active path; rollback is deliberate, named, reviewed.

### 5.1 P2 — `workflow_dispatch` is still a manual deploy path
`deploy.yml` won't auto-run from marketplace-pivot (trigger is `branches:[main]`), but a human can manually `workflow_dispatch` it from any branch carrying the file. Before #304 that would create a stray `kuruma-web-pages` project on the *old* CF account. Mitigation:
1. **Guard:** gate the `Deploy web to CF Pages` + `Smoke test web (Pages)` steps behind `if: vars.WEB_PAGES_DEPLOY_ENABLED == 'true'` (a repo variable, unset by default). Build + dist-size still run (harmless, useful signal). Activation is deliberate and named — matches the Learn heuristic above.
2. **PR note:** "Do not `workflow_dispatch` deploy.yml before #304; set `WEB_PAGES_DEPLOY_ENABLED=true` only after the account migration."

---

## 6. Verification plan (what "green" means here)

Live deploy CANNOT be verified (gated on #304). So verification is config-correctness + full local CI gate:
1. `bun run lint:dist-size` passes (build first).
2. New unit test (`wrangler-pages-config.test.ts`) passes — config invariants hold.
3. `deploy.yml` parses: `actionlint` if available, else YAML lint + manual review of the job graph.
4. Full ci.yml gate locally green: `bun run lint` · `bun run typecheck` (all pkgs) · `lint:boundaries` · `lint:modules` · export-drift · fk-indexes · i18n-parity · `bun run test` (shared+api+web) · `bun run --filter @kuruma/web build` · `lint:dist-size`.
5. `wrangler pages deploy ... --dry-run` if the installed wrangler supports it (validates config without a live account) — best-effort, note result.
6. code-reviewer + architect-review before PR.

**Explicitly NOT claimed:** that the Pages deploy works end-to-end. The PR states it is reviewed-only, live-verify deferred to #304.

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| `wrangler pages deploy` picks up the Worker `wrangler.jsonc` | Verified: it warns and **ignores** it (no `pages_build_output_dir`), then proceeds. Cosmetic warning only |
| `global_fetch_strictly_public` not applied to Functions | Set via `pages:create-project --compatibility-flag`; #304 live-verify confirms |
| `API_ORIGIN` subdomain changes at #304 | One-line var update; cross-referenced in the migration doc §6 + PR body |
| Someone sets `VITE_API_BASE_URL` later and breaks same-origin | Inline comment in deploy step + a note in the config test |
| deploy.yml accidentally runs before #304 | Inert: triggers only on `branches:[main]`; this PR targets marketplace-pivot |

---

## 8. Post-merge HUMAN steps (all gated on #304)

1. Land #304 (freelance CF account + token/account-id secrets).
2. Create the Pages project with its compat flags: `bun run --filter @kuruma/web pages:create-project` (this is what sets `global_fetch_strictly_public`). Run **once** — it errors if the project already exists. Confirm the flag live in the dashboard (Settings → Functions → Compatibility flags); nothing re-asserts it afterward.
3. Set the proxy's upstream: `echo "<api-worker-url>" | bunx wrangler pages secret put API_ORIGIN --project-name=kuruma-web-pages` (or a plaintext var in the dashboard). Use the freelance subdomain (migration doc §6).
4. Set repo **variable** `WEB_PAGES_DEPLOY_ENABLED=true` (`gh variable set WEB_PAGES_DEPLOY_ENABLED -b true`) — un-gates the Pages deploy+smoke steps (§5.1).
5. Run the deploy (push to main once cut over, or `gh workflow run deploy.yml`). First deploy publishes `kuruma-web-pages.pages.dev`; note the origin.
6. Create GitHub Secret **`AUTH_URL`** = the Pages origin (e.g. `https://kuruma-web-pages.pages.dev`).
7. Register `<AUTH_URL>/auth/google/callback` in Google Cloud Console (OAuth redirect URI).
8. Run **`rotate-secrets.yml`** (workflow_dispatch) to assert API-Worker secrets incl. `AUTH_URL`.
9. Live-verify: load the Pages URL, exercise Google login round-trip + a `/api` fetch; confirm the proxy + cookie are same-origin.
10. Then proceed to #500 (CSP enforce) and #501 (e2e on preview).
