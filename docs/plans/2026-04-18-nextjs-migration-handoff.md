# Handoff: migrate web off Next.js

**Status:** brainstorming in-progress (design approved for framework + hosting; auth section presented, awaiting user sign-off; i18n + migration sequencing still to draft).
**Owner:** next session continues from the brainstorming flow below.
**Date:** 2026-04-18

---

## Why we're migrating

The web package deploy is blocked by CF Workers size limits. Current `handler.mjs` is **10.5 MiB** compressed, over both tiers:

- CF Workers free: 3 MiB
- CF Workers paid: 10 MiB
- Our bundle: ~10.5 MiB handler + 2.2 MiB `@vercel/og` wasm/js + 0.9 MiB middleware ≈ **13.6 MiB total**

Root cause: Next.js + React 19 RSC + Auth.js + DrizzleAdapter + postgres driver all get bundled into a single Worker by `@opennextjs/cloudflare`. The Next.js runtime alone is ~4–5 MiB before any app code.

User decision (this session): migrate off Next.js ASAP to a stack that fits CF free tier with headroom, so we can continue feature development without fighting infra.

## Where we are right now

**Production state:**
- API Worker is deployed and healthy (Hono on CF Workers — this stays, it's tiny).
- Web Worker last successful deploy was pre-lockup; the current `main` has not shipped to the web Worker.
- Secrets-management rework (PR #347) merged — deploy.yml no longer calls `wrangler secret put` on every deploy (that was tripping wrangler 4's gradual-deployment lock). Secrets presence is now verified read-only; `rotate-secrets.yml` (workflow_dispatch) is the re-assert path.
- Next auto-deploy (post-#347) **failed on web Worker size**, not on secrets — the migration problem is now surfaced clearly.

**Brainstorming progress (superpowers:brainstorming flow):**
- ✅ Project context explored (18 routes, 60 client components, 17 thin server pages, middleware does JWT + role + locale)
- ✅ Approach proposed + user approved: **Vite + TanStack Router, SPA with prerendered public routes, hosted on CF Pages**
- ✅ Auth architecture section presented — **waiting for user sign-off**
- ⏳ i18n section not yet presented
- ⏳ Migration sequencing + bridge strategy not yet presented
- ⏳ Design spec not yet written to `docs/superpowers/specs/`
- ⏳ Spec self-review, user review, then writing-plans — all pending

## The agreed direction

**Stack:**
- **Vite + TanStack Router** (note: *not* React Router — TanStack Router is a different lib from the same team that built TanStack Query, which the codebase already uses; file-based routing, type-safe links, `loader` pattern integrates natively with React Query)
- **CF Pages** for the web package (not CF Workers) — unmetered static hosting, no size limit, no wrangler versioning drama, free forever
- **Hono API stays on CF Workers** as-is
- **Auth.js moves to the Hono API side** as `@auth/core` — keeps existing Google/Apple OAuth, removes Drizzle/pg from web bundle
- **Middleware → TanStack Router `beforeLoad` route guards**
- **next-intl → TanStack Router locale route params or react-i18next** (pending user call)
- **Forms → react-hook-form + zod → Hono API** (already their pattern)

**Realistic effort estimate:** 3–5 focused days. Components port unchanged (shadcn/Tailwind/business logic all stay). The real work is routing rewrite + auth adapter.

**What the user leans toward on open questions:**
- SEO: nice-to-have, not die-or-die — justifies the SPA-with-static-prerender choice over full SSR
- Paid plan: has not committed; implicit preference is "fit free tier forever" since that was the explicit motivation for migrating

## Auth architecture (presented, awaiting sign-off)

Proposal summary:
- Session endpoints (`/auth/google/start`, `/auth/google/callback`, `/auth/session`, `/auth/signout`) move to Hono API using `@auth/core`
- DrizzleAdapter stays, but runs on API side where Drizzle + pg already live
- Session transport: HTTP-only cookie set by API, web reads via `useSession()` hook (React Query, short cache)
- Route guards: TanStack Router `beforeLoad` on `/manage/*`, `/bookings/*` — queries session, redirects if missing/wrong role
- API enforcement remains the real security boundary

**Flagged trade-off:** API and web on different CF domains means cookies need `SameSite=None; Secure` + shared parent domain once a real domain is attached, or reverse proxy for same-origin. Works fine; design should state it explicitly.

## What the next session should do

1. **Continue the brainstorming flow** from the auth section.
   - Ask user: does the auth proposal look right? Push back on anything?
   - Then present i18n section: pick between (a) TanStack Router locale param + a lean i18n lib (e.g., `@lingui/core`, `react-i18next`, or a homemade JSON+context), (b) full react-i18next with its middleware. Recommend based on bundle size + DX.
   - Then present migration sequencing: slice plan (e.g., public routes first → auth → business dashboard → renter flows), feature-flag approach, what lands behind which cutover switch.
   - Then cover bridge strategy: do we pay $5/mo for CF Workers Paid temporarily so web deploys keep working during migration, or freeze web deploys and rely on the last green build? Recommend paid plan bridge; it's $5 for a week or two.
2. **Write the spec** to `docs/superpowers/specs/2026-04-18-migrate-web-off-nextjs-design.md` once all sections are approved. Follow the superpowers:brainstorming skill's spec format.
3. **Self-review the spec** (placeholders, contradictions, ambiguity, scope) and fix inline.
4. **Ask user to review** the committed spec before proceeding.
5. **Invoke `superpowers:writing-plans`** to produce the implementation plan. Do NOT invoke any other skill from brainstorming — that's the only valid terminal skill per the flow.

## Key files / context for the next session to read

- `CLAUDE.md` — project conventions, deploy pipeline notes, gotchas (esp. the post-#347 secrets rework entry)
- `.github/workflows/deploy.yml` + `.github/workflows/rotate-secrets.yml` — deploy story post-PR #347
- `packages/web/src/middleware.ts` — what route guards need to replicate
- `packages/web/src/auth.ts` + `packages/web/src/auth.config.ts` — current NextAuth setup with DrizzleAdapter
- `packages/web/src/app/` — route tree to port (18 routes under `[locale]/(auth|renter|business|public)`)
- `packages/web/src/i18n/` — current next-intl config
- `packages/web/package.json` — deps to prune (next, next-auth, next-intl, @opennextjs/cloudflare, wrangler goes to API only)
- `packages/api/src/` — where Auth.js Core endpoints will land
- `packages/shared/src/db/schema.ts` — users/accounts tables the auth adapter needs

## Session memory already persisted (no re-ask needed)

These are already in the user's memory; pull them if relevant:
- Vertical-slice mandatory, TDD non-negotiable
- Always use worktrees for feature work
- Never force push
- Use atomic edits for renames (biome reverts intermediate states)
- Review before ship — code-reviewer + architect before every PR
- Verify remote before planning (fetch + gh pr list)
- Dep audit must scan CSS `@import` not just JS imports

## Open PRs / issues touched this session

- **PR #347** (merged): `ci(deploy): stop re-asserting secrets every deploy; add rotation workflow` — unblocked the secrets side of the deploy pipeline; the web size limit was the next failure to surface.
- No GitHub issue has been opened yet for the migration itself. Before implementation begins, create an issue with the final spec as the body per project convention (`Closes #N` in the eventual PR).

## Hard gate reminder

Per the superpowers:brainstorming skill: **do not write any code, scaffold any project, or invoke any implementation skill** until the full design is presented, written to a spec doc, self-reviewed, and the user has approved the committed spec. The only valid next skill after brainstorming is `superpowers:writing-plans`.
