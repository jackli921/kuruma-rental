# Handoff — #603 shared businessNavItems (Vite nav refactor)

**State:** Implemented, committed, pushed, **PR #609 OPEN → `marketplace-pivot`** (Closes #603). NOT merged.
CI running (BLOCKED = checks pending, not a conflict). Behavior-preserving refactor.

## Where
- Worktree `~/Dev/kuruma-603-manage-nav`, branch `feat/603-manage-nav-items` (off `marketplace-pivot` @ `b51c001`).
- Commit `79eea6f`. PR #609.

## What it does
Extracts the operator (business-view) nav into one source of truth to kill the
"nav-link conflict tax" (every `/manage/*` route used to 3-way-conflict on Navbar
array + MobileMenu `NavTo` union + nav-count test).
- NEW `packages/web/src/vite/nav/business-nav-items.ts` — `businessNavItems` (8 `{to,labelKey}` items, `as const`) + derived `BusinessNavTo` type.
- `vite/nav/Navbar.tsx` maps over the array for the business nav.
- `vite/nav/MobileMenu.tsx` — `NavTo = BusinessNavTo | 3 renter routes`; union can't drift now.
- `tests/vite/nav/Navbar.test.tsx` — count derived from `businessNavItems.length` (no magic 8).
- NEW `tests/vite/nav/business-nav-items.test.ts` — locks route list/order + every `labelKey` resolves in `nav` i18n.

## Gates (all green pre-push)
web suite **1027 pass** · tsc clean (web+node+api) · biome clean · lint:size/boundaries · pre-commit hook (3× tsc) green.
Did NOT dispatch code-reviewer/architect — architect already specified this exact design in #603; refactor is behavior-preserving.

## NEXT (to finish #603)
1. Watch CI on #609 → green.
2. Likely BEHIND (swarm fast) → `gh pr update-branch 609`, re-poll CI green (require-up-to-date races twice are common here).
3. `gh pr merge 609 --squash`. Base ≠ default → **manually close #603 + drop `in-progress` label** (or it may auto-close via "Closes #603"; verify).
4. Teardown: `git worktree remove ~/Dev/kuruma-603-manage-nav` + `git branch -D feat/603-manage-nav-items` (remote lingers, ruleset).

## Gotchas
- TWO nav trees exist: frozen `src/components/nav/*` (Next.js — DO NOT TOUCH) and `src/vite/nav/*` (this work).
- biome reorders imports (`business-nav-items` sorts after `NavbarClient`); re-read files after format before next Edit.
- `labelKey`s are under the `nav` i18n namespace (resolved by `useTranslations('nav')`), already present in en/ja/zh — no i18n change needed.

## Then: pick a P1 (user direction = "#603 then a P1")
Operator portal epic #523 nearly done — only #527 (vehicle detail, CLAIMED) + #589 (manual booking Slice E, unclaimed but #525 worktree live) remain.
Recommended next P1: **#462** platform admin per-partner revenue/commission portal (admin shell #541 already merged; AFK-friendly). Other P1s: #509 demo integration, #515/#516 renter docs (Du deprioritized these).

## Context
#585 add-ons MERGED (`1a8e41b`, PR #602); both its duplicate worktrees retired. This #603 follows from that review.
Memory: `project_603-nav-items` + `project_585-addons-ui` + `feedback_nav-link-conflict-tax`.
