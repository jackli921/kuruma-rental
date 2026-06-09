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
1. New CF Pages config file `packages/web/wrangler.pages.jsonc` (project name, `pages_build_output_dir`, compat flags, `API_ORIGIN` var).
2. `deploy.yml`: replace the four frozen web-Worker steps with live Pages steps — vite build → `wrangler pages deploy` → smoke. (See Open Question §5 for keep-vs-delete.)
3. `package.json` (web): a `deploy:pages` convenience script so the deploy command has one source of truth.
4. A small unit test asserting the Pages config is internally consistent (project name, output dir, `API_ORIGIN`, compat flags) — keeps the cutover config from silently drifting.
5. Doc: this plan + a short PR note spelling out the #304 gate and the post-merge human steps.

**Out of scope** (later slices / other issues)
- DNS flip + old Worker deletion + Next.js source deletion + dep pruning → §8 step 6 cutover, NOT now.
- Re-enabling admin/booking e2e on the Pages preview URL → #501.
- Flipping CSP Report-Only → enforcing → #500 (needs live preview).
- Any API-Worker changes (its deploy steps are untouched).

---

## 3. Design decisions

### 3.1 New Pages config file (don't overload the Worker config)
`packages/web/wrangler.jsonc` is a **Worker** config (`main: .open-next/worker.js`, `assets`). CF Pages needs `pages_build_output_dir`, which is incompatible in the same file. So add a separate `wrangler.pages.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kuruma-web-pages",
  "pages_build_output_dir": "dist",
  "compatibility_date": "2025-04-01",
  // global_fetch_strictly_public: the proxy Functions fetch() the API Worker's
  // *.workers.dev URL. Without this flag CF short-circuits inter-Worker fetches
  // internally and returns 404 (same bug the Worker hit — see wrangler.jsonc).
  // The flag must also be enabled on the Pages project; verified at #304.
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  // API_ORIGIN is the API Worker URL the proxy forwards to. NOT a secret →
  // plaintext var is fine. Updated to the freelance subdomain at #304
  // (see docs/cloudflare-account-migration.md §6).
  "vars": { "API_ORIGIN": "https://kuruma-api.kanata-studio-dev.workers.dev" }
}
```

Keep `packages/web/wrangler.jsonc` (Worker) untouched — it is deleted at the §8 step 6 cutover, not here.

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
        run: npx wrangler pages deploy dist --project-name=kuruma-web-pages --branch=production --commit-dirty=true --config wrangler.pages.jsonc

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
`wrangler pages deploy --project-name=X` auto-creates the project on first run. `API_ORIGIN` + compat flags come from `wrangler.pages.jsonc`. No manual dashboard step for those. (The `global_fetch_strictly_public` Pages-project flag is the one thing that needs dashboard/#304 verification.)

---

## 4. Files to change

| File | Change |
|------|--------|
| `packages/web/wrangler.pages.jsonc` | **new** — Pages project config (§3.1) |
| `.github/workflows/deploy.yml` | delete the 4-step frozen Worker deploy block; add live Pages steps (deploy+smoke guarded by `WEB_PAGES_DEPLOY_ENABLED`); swap `WEB_WORKER_URL`→`WEB_PAGES_URL` env (§3.2, §5) |
| `packages/web/package.json` | add `"deploy:pages"` script (single source of truth for the deploy cmd) |
| `packages/web/src/__tests__/wrangler-pages-config.test.ts` | **new** — assert config invariants (project name, output dir, API_ORIGIN, compat flags) |
| `docs/plans/2026-06-09-378-pages-cutover.md` | this plan |
| PR body | #304 gate + post-merge human steps |

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
| `wrangler pages deploy` picks up the Worker `wrangler.jsonc` and errors | Pass `--config wrangler.pages.jsonc` explicitly; test with `--dry-run` |
| `global_fetch_strictly_public` not honored from Pages config | Documented as #304 live-verify item; flag also set on project in dashboard |
| `API_ORIGIN` subdomain changes at #304 | One-line var update; cross-referenced in the migration doc §6 + PR body |
| Someone sets `VITE_API_BASE_URL` later and breaks same-origin | Inline comment in deploy step + a note in the config test |
| deploy.yml accidentally runs before #304 | Inert: triggers only on `branches:[main]`; this PR targets marketplace-pivot |

---

## 8. Post-merge HUMAN steps (all gated on #304)

1. Land #304 (freelance CF account + token/account-id secrets, enable `global_fetch_strictly_public` on the Pages project).
2. Set repo **variable** `WEB_PAGES_DEPLOY_ENABLED=true` (gh: `gh variable set WEB_PAGES_DEPLOY_ENABLED -b true`) — un-gates the Pages deploy+smoke steps (§5.1).
3. First deploy creates `kuruma-web-pages.pages.dev`; note the origin.
3. Create GitHub Secret **`AUTH_URL`** = the Pages origin (e.g. `https://kuruma-web-pages.pages.dev`).
4. Register `<AUTH_URL>/auth/google/callback` in Google Cloud Console (OAuth redirect URI).
5. Run **`rotate-secrets.yml`** (workflow_dispatch) to assert API-Worker secrets incl. `AUTH_URL`.
6. Live-verify: load the Pages preview, exercise Google login round-trip + a `/api` fetch; confirm the proxy + cookie are same-origin.
7. Then proceed to #500 (CSP enforce) and #501 (e2e on preview).
