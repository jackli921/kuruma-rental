# Deploy blocker — situation analysis & options (for senior-eng evaluation)

**Date:** 2026-06-06
**Context:** Marketplace MVP proposal §8; epic #385; deploy red since 2026-04-19.
**Related:** #378 (Vite migration epic), #423 (bundle dry-run), #372 (CSRF), #373 (domain), #377 (i18n).
**Status:** **DECIDED 2026-06-06 — Option B now** (see §0).

---

## 0. Decision (confirmed by senior eng, 2026-06-06)

**Do B now** (Vite + CF Pages migration, #378) — unless a committed demo lands inside the next ~3 business days. The constraint is structural: the handler alone already exceeds the paid Worker cap, so trimming (C) is ritual motion and deferral (D) compounds migration cost while deploy stays red. **C and D rejected.**

**Auth front-load — reframed.** Do **not** relocate auth in-place inside the old Next app. Instead stand up a **minimal CF Pages shell + Pages Functions proxy + API auth proof**. The same-origin proxy is itself part of proving cookie auth.
- **First risk-retirement milestone:** Google + Apple OAuth green on a **CF Pages preview**, cookie `SameSite=Lax`, CSRF enforced, Apple form-POST carve-out tested.

**Checkpoint (pinned 2026-06-06):** end of **migration day 2**, counted from when Slice 0 starts *with required secrets/access available*.
- **Pass criteria:** CF Pages preview exists; `/api/*` and `/auth/*` proxy through Pages Functions; Google + Apple OAuth green on the preview; session cookie `SameSite=Lax`; CSRF rejects missing/bad tokens; Apple callback carve-out has a test.
- **Fail criteria:** if the proof is not green by the checkpoint, trigger **A the next morning** as a one-day bridge — freeze non-demo Next.js feature work — then return to B.

**A = contingency only.** Triggered solely by (a) a committed demo date inside the migration window, or (b) the checkpoint failing per above. A is one timeboxed day; it never becomes the plan.

**Doc correction applied:** the migration spec's stray `SameSite=None` (endpoint bullet §5.1) is fixed to `Lax`; `Lax` is the source of truth.

---

## 1. The situation (grounded in measurements)

The web package deploys as a single Cloudflare Worker via `@opennextjs/cloudflare`. Measured bundle:

| Component | Size |
|---|---|
| Next.js handler (runtime + React 19 RSC + Auth.js + DrizzleAdapter + postgres driver) | **10.5 MiB** |
| `@vercel/og` (pulled in by the Next runtime — **not** imported in our app code) | 2.2 MiB |
| Middleware | 0.9 MiB |
| **Total** | **~13.6 MiB** |

Cloudflare Worker size caps: **3 MiB free**, **10 MiB paid** (gzipped). We exceed both. Deploys fail on size — this is why production has been red since 2026-04-19.

**Root cause:** `@opennextjs/cloudflare` packages the entire Next.js server runtime into one Worker. The Next runtime alone is ~4–5 MiB *before* any app code. This is structural to "Next.js SSR on Workers," not a function of our app being heavy.

**Why it only gets worse:** every web feature slice (waves A–C: notifications UI, search views, wizard, payment, admin portal) adds to the handler. We're at 10.5 MiB on the handler today; the marketplace slices will push it further. The size pressure is monotonic.

## 2. Why the cheap fixes don't work

- **Paid tier ($5/mo) alone:** buys headroom only to 10 MiB. The handler is *already* 10.5. Doesn't fit even before shedding nothing else.
- **Trimming under 10 MiB:** even if we fully remove `@vercel/og` (2.2) and shrink middleware (0.9), the **10.5 MiB handler remains over the 10 MiB cap** — and it grows with each slice. Trimming buys, at best, a few weeks of denial. Not a path to a stable MVP.
- `@vercel/og` is reachable to remove (we don't use `ImageResponse`/OG routes), but removing it doesn't clear the binding constraint.

## 3. The options

### A. Stopgap host for the demo (non-CF) — sidestep
Host the Next.js web app on a Node-capable platform (Vercel / Railway / Fly / a container) for the demo; keep the Hono API on CF Workers (tiny, unaffected).
- **Effort:** ~0.5–1 day to wire a second deploy target.
- **Unblocks:** a *hosted demo* immediately, on the current stack, with zero migration risk.
- **Costs / risks:** (1) demo runs on infra that is **not** the production target — "works in the demo" doesn't prove production; (2) two deploy setups to maintain meanwhile; (3) #378 still must happen later, by which point **every marketplace slice has been built on Next.js and must be ported** — larger migration surface; (4) doesn't resolve the auth-relocation work, just defers it.
- **Reversibility:** fully reversible (throwaway host).

### B. Do the #378 Vite + CF Pages migration now — the real fix
Migrate `packages/web` to Vite + TanStack Router on CF Pages (static, **no size limit**), relocate Auth.js from web into the Hono API (cookie session instead of Bearer), rename `next-intl` → `use-intl`.
- **Effort:** **3–5 focused days** (per the approved design doc `2026-04-18-migrate-web-off-nextjs-design.md`). Design is done, with a decision-razor/defaults table for every small fork.
- **Unblocks:** production-grade hosting permanently; size limit becomes a non-issue forever; the demo runs on the real production infra.
- **Costs / risks:** (1) auth relocation (web→API, Bearer→HttpOnly cookie) is the genuine-risk piece — touches OAuth (Google + Apple), CSRF (#372), and SameSite/domain (#373); (2) router rewrite + data-fetching refactor is mechanical but broad (~79 i18n call sites, all routes); (3) could surface hidden coupling (timeline spec's pessimistic case).
- **Reversibility:** the auth-model change is the one semi-one-way door; the rest is reversible. Mitigation: land auth relocation behind the existing API on a branch, E2E the OAuth flow on staging before cutover.
- **Sequencing note:** migration surface grows with every Next.js slice we ship. Doing B **earlier** is strictly cheaper than doing it later.

### C. Trim under the 10 MiB paid tier — buy time
Remove `@vercel/og`, shrink middleware, lazy-load, code-split.
- **Effort:** 1–2 days of bundle archaeology.
- **Unblocks:** nothing durably — handler is already 10.5 and climbing. See §2.
- **Verdict:** not a real option on its own; at best a bridge if B is chosen but can't land before a hard demo date.

### D. Defer — keep building features, decide later
- **Effort:** 0 now.
- **Risk:** deploy stays red; demo-readiness unproven; migration surface keeps growing; we discover integration problems at the worst time (right before the demo). Highest-risk option despite lowest immediate cost.

## 4. Rationale & recommendation

The decision hinges on separating **demo-ready** from **production-ready**, and on one fact that flips the usual "stopgap now, real fix later" instinct: **the real fix is only 3–5 days and already designed.**

When the real fix is cheap and designed, the stopgap (A) mostly buys *risk*, not time: you stand up throwaway infra, keep shipping slices onto the framework you're about to abandon (growing the port), and still owe the auth-relocation work later. The migration's cost is monotonically increasing in the number of Next.js slices shipped — so the cheapest moment to do #378 is **now, before waves A–C**, or as early as possible alongside them.

**Recommendation (for the reviewer to confirm or override):**
1. **Schedule #378 as the immediate next engineering block** — ideally before/parallel to Wave A, so later slices are built on the target stack and don't need porting. It's 3–5 days, already designed.
2. **Front-load the risky piece:** do the Auth.js web→API relocation (#372) first on a branch and prove Google+Apple OAuth on staging before touching routing. That retires the only semi-one-way door early.
3. **Keep option A in the back pocket** purely as a contingency: if a hard demo date lands inside the 3–5 day window, or if auth relocation surfaces hidden coupling, deploy the demo to a Node host as a bridge while B finishes.
4. **Reject C and D as primary strategies** — C doesn't clear the constraint; D lets the problem compound.

**The one input that changes this recommendation:** if there is a demo commitment in the next ~3 business days, flip to A-now-then-B. Otherwise B-now dominates.

## 5. Open questions for the reviewer
- Is there a fixed demo date? (Decides A-bridge vs straight-B.)
- Appetite for the auth-model change (Bearer→cookie) now vs. after the demo? (It's the real risk; everything else is mechanical.)
- Domain/DNS readiness for #373 (parent-domain cutover) — owner decision, can lag behind B's main work.
