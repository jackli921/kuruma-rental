# #521 Handoff — Slice C complete, Slice D next

**Date:** 2026-06-12
**Branch:** `feat/521-provider-login` (worktree `~/Dev/kuruma-521-provider-login`)
**Tip:** `aa0feb4` · **18 commits LOCAL, not pushed** · ahead 18 / behind 2 vs `origin/marketplace-pivot`
**Plan = source of truth:** `docs/plans/2026-06-10-issue-521-provider-login-operator-access.md` (§8/§9-D)
**DB:** docker `kuruma-521-login-pg` postgres:16 on **:5442** · `DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test`

---

## Done this session (both green, committed)

| Slice | Commit | Gate |
|---|---|---|
| **B9** public `GET /provider-invites/:token/preview` | `b8778ec` | api 1147 · integration 201 · typecheck/boundaries/biome ✓ |
| **C** provider login + invite pages + `/manage/$slug` guard | `aa0feb4` | web vitest 754 · typecheck 0 · i18n-parity 750 · vite build ✓ · biome ✓ |

**B9** — `ProviderInviteService.preview(token)` (injected `operatorRepo`): hash→`findByTokenHash`, returns `{ valid, operatorName?, expiresAt? }` **only — never the email**. `valid = exists && PENDING && expiresAt>now`; unknown/expired/used → `valid:false` (expired/used still name the operator). New `routes/provider-invites.ts` mounted public under `/provider-invites/*` (NOT `/admin/*`, so it escapes `requireAuth`), inside `publicCatalogLimiter`. `ProviderInviteService` ctor gained `operatorRepo` as 2nd arg — index.ts:481 updated.

**C** — files added/changed:
- `vite/session.ts` — `Session.user` += optional `operatorId`/`operatorSlug` (API `/auth/session` already returns them, auth.ts:267-268).
- `vite/guards.ts` — `manageGuard(session, slug)` = `businessGuard` AND `session.user.operatorSlug === slug`, **fail-closed** (business role w/o slug = forbidden).
- `vite/auth/GoogleIcon.tsx` — extracted from `LoginCard` (now imported by both cards).
- `vite/provider/ProviderLoginCard.tsx` — provider copy, action `/auth/google/start?intent=provider&returnTo=/<locale>/manage`.
- `vite/provider/api.ts` `fetchInvitePreview(token)` + `vite/provider/ProviderInviteCard.tsx` — preview render; accept action `…?intent=provider&invite=<token>&returnTo=…`; invalid → unavailable state (no CTA).
- routes: `$locale/provider/login.tsx` (signed-in operator → own dashboard), `$locale/provider/invite/$token.tsx` (loader preview), `$locale/manage/$operatorSlug.tsx` (`manageGuard` layout) + `$operatorSlug/dashboard.tsx` (stub, #512 fills).
- i18n `auth.provider.*` (+ `invite.*`) in en/ja/zh.
- `routeTree.gen.ts` regenerated + staged. `manage/bookings` (existing) and `manage/$operatorSlug/*` coexist cleanly.

---

## FIRST: rebase onto `origin/marketplace-pivot` (behind 2)

The 2 upstream commits are **#546** (renter "My Bookings" list + lean renter nav) and **#548** (operator booking detail drawer). They touch `packages/web/{nav,bookings}`, `_renter/bookings/index.tsx`, `_business/manage/bookings.tsx`, the **message JSONs**, and **`routeTree.gen.ts`**. No api/shared/drizzle conflict — **0048 safe**.

```
git fetch origin marketplace-pivot
git rebase origin/marketplace-pivot
```
Expected conflicts:
- **`packages/web/src/routeTree.gen.ts`** (both regenerate it) → take either side, then `bun run --filter @kuruma/web build` to regenerate, `git add` it, `git rebase --continue`.
- **`packages/web/messages/{en,ja,zh}.json`** (possible) → keep **BOTH** key sets (their renter/nav keys + my `auth.provider.*`); then `bun run lint:i18n-parity`.

---

## Slice D (web) — the only slice left

Per plan §8 / §9-D. Goal: not-authorized panels + renter regression + complete i18n.

### D1 — error panels on `provider/login`
The OAuth callback, on a **failed** provider attempt, redirects to `/<locale>/provider/login?error=access_not_found|invite_invalid` and **mints NO session** (auth.ts:195-198 — "the provider door alone never logs anyone in"). **So the user is signed OUT on that page.**
→ The plan §8 says "sign out + request access", but **sign-out is moot** (no session). Build the panel as: **error message + a `mailto:` request-access link only.** (If you want a "back to sign in" affordance, link to `/<locale>/login`.)

- `routes/$locale/provider/login.tsx`: add `validateSearch` reading `error?: 'access_not_found' | 'invite_invalid'` (validate against the two literals; ignore anything else).
- Render: when `error` present, show the not-authorized panel (distinct copy per discriminant — `access_not_found` = "no operator access for this Google account"; `invite_invalid` = "this invite is expired/used/for a different email"); else the normal `ProviderLoginCard`. Put the panel in `ProviderLoginCard` (new optional `error` prop) or a sibling `ProviderAccessDeniedPanel` — your call; keep it TDD'd.
- `mailto:` target: use an env/config contact address if one exists, else a placeholder constant (MVP; the real request form is a §13 follow-up).

### D2 — i18n keys (en/ja/zh, keep parity)
Add under `auth.provider`: `accessNotFoundTitle`/`accessNotFoundBody`, `inviteInvalidTitle`/`inviteInvalidBody`, `requestAccess` (mailto label). (`invite.expiredTitle/expiredBody` already exist from C.) Run `bun run lint:i18n-parity`.

### D3 — renter-login regression
Confirm the renter flow is unbroken after the `GoogleIcon` extraction + session-type change. Existing tests: `tests/vite/auth/LoginCard.test.tsx`, `tests/vite/auth/login-route.test.ts`. Add/confirm an explicit assertion that renter `/login` still POSTs `/auth/google/start` (no `intent`) and lands renter dest.

### D4 — gate + finish
- Per commit: `bun run --filter @kuruma/web test` (754+), `--filter @kuruma/web typecheck`, `bun run lint:i18n-parity`, `bunx biome check --write <files>`, `vite build` (if any route changes → re-stage `routeTree.gen.ts`).
- Then: rebase (if needed) → `git push -u origin feat/521-provider-login` → open PR **`Closes #521`**. Base = `marketplace-pivot` (**non-default**), so `Closes` won't auto-fire on merge → **close #521 manually**. Run `/code-review`.

---

## Gotchas (carried)
- **API tests = vitest, NOT bun:test** — import from `'vitest'`. `bun test <file>` lies; the gate is `vitest run`.
- **Pre-commit hook runs biome + size + boundaries + tsc, NOT the test suites** → run `bun run --filter @kuruma/api test` and `--filter @kuruma/web test` manually each commit.
- **biome import-sort is an ASSIST** → `bunx biome check --write <file>` (not `bun run format`).
- **Adding/removing a route file → `bun run --filter @kuruma/web build` to regen `routeTree.gen.ts` BEFORE typecheck, and STAGE it.** Typed `Link`/`redirect` `to` resolve against the gen.
- **Web tests mock `@tanstack/react-router` (Link→`<a>`) and `use-intl` (`useTranslations`)** — see `tests/vite/provider/*` for the pattern; the `t(key, params)` mock must interpolate `{operator}`.
- **`operatorSlug` = the STORED `operators.slug`** via `findOperatorSlug`, never `slugify(name)`.
- **Reference (READ-ONLY):** `feat/521-provider-auth@efab42f` — its callback/session plumbing; it has **no** preview handler (the prior handoff was wrong about that).
- `lint:i18n-parity` is a **root** script (`bun run lint:i18n-parity`), not a `--filter @kuruma/web` one.
