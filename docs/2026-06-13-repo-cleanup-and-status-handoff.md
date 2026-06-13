# Repo Cleanup & Status Handoff — 2026-06-13

## 0. Snapshot

| | |
|---|---|
| Trunk (integration branch) | `marketplace-pivot @ 95cc40d` |
| Open PRs | **0** — queue fully drained |
| Canonical MVP | **Complete** — renter 7/7 + operator 8/8 + admin/geocoding/infra all shipped |
| MVP epic #385 / portal epic #523 | both still **OPEN** (close candidates — see §1e) |
| Tech debt | **Very low** — near-zero type escape hatches, 3 TODOs, 1 soft size warning |

> **Swarm caveat.** Multiple sessions work this repo in parallel; worktrees, local/remote branches, and PRs change minute-to-minute. **Always `git fetch origin` and re-list worktrees before acting on anything in §1.** This snapshot was true at `95cc40d`.

---

## 1. Cleanup checklist

### 1a. Junk — safe to delete now (untracked, non-shared)
- **`txt`** (repo root) — a stray shell-redirect artifact containing a demo-seed command (`cd …kuruma-marketplace-pivot / bun run db:seed`). No secrets, no references. **Delete.**
- **`.gh640art/`** (repo root) — a Playwright HTML report artifact from an E2E run. **Delete**, and add `.gh640art/` (or the report path) to `.gitignore` if these recur.

### 1b. Untracked handoff docs (~25) — archive, don't commit to `docs/` root
All describe work whose issue is **CLOSED**. Recommendation: `mkdir -p docs/archive/2026-06/` and `git mv`/move them there (preserves history, declutters `docs/`). Pure-transient snapshots can be deleted outright.

**DONE → archive:** the `2026-06-1x-issue-{504,521,526,527,531,560,585,616}-*`, `2026-06-13-issue-{462,583,603}-*`, `operator-{new-order-badge,substitution-ui}-handoff.md`, `2026-06-12-operator-pricing-config-ui-handoff.md`, `2026-06-1x-issue-521-*` (6 files), `docs/plans/2026-06-09-issue-509-*`, `docs/plans/2026-06-10-issue-521-*`.
**DONE → delete (transient diagnostics):** `2026-06-12-fleet-load-error-debug-handoff.md`, `2026-06-12-mvp-verify-handoff.md`, `2026-06-12-pr-drain-575-rescue-handoff.md`.
**STALE (superseded direction):** `docs/plans/2026-06-09-slice-459-renter-documents.md` — #459 closed but the IDP-upload approach was dropped for the 免责声明/disclaimer pivot. Delete or mark Superseded.

**KEEP → commit (still-relevant references / active plans):**
- `docs/2026-06-13-mvp-complete-handoff.md` — MVP completion cert + re-prove runbook.
- `docs/2026-06-13-platform-operator-renter-separation-map.md` — role/guard separation map (+#487 cleanup surface).
- `docs/plans/2026-06-12-renter-location-search-niconico.md` — approved design for the next build (#394/#651).
- `docs/plans/2026-06-13-issue-651-renter-location-search-build.md` — active impl plan for #651.
- _This file._

### 1c. Worktrees — VERIFY OWNER FIRST, do not auto-remove
Several worktrees sit exactly at mp HEAD (`95cc40d`), clean. That can mean *either* "leftover after merge" *or* "freshly-created, work not started yet" — and several map to **open** issues. Treat as possibly-active. Confirm no owning session + no open in-progress issue before removing. **Never remove a worktree with unpushed commits or uncommitted changes.**

| Worktree | Branch | State | Action |
|---|---|---|---|
| `~/Dev/kuruma-394-region-search` | `feat/394-region-search` | 5 **unpushed** commits, clean, #394 OPEN | **LEAVE** — only copy of #394 work |
| `~/Dev/kuruma-521-provider-auth` | `feat/521-provider-auth` | 7 **unpushed** commits (likely superseded by merged #550, not an ancestor) | **VERIFY then remove** — owner confirms nothing unsalvaged |
| `~/Dev/kuruma-645-admin-revenue` | `test/645-admin-revenue-gate` | == mp HEAD, clean, #645 OPEN | **LEAVE** — likely active (#645 demo-gate work) |
| `~/Dev/kuruma-647-authz` | `refactor/647-booking-authz` | == mp HEAD, clean, #647 in-progress | **LEAVE** — likely active (#647 authz reconcile) |
| `~/Dev/kuruma-test-coverage` | `test/coverage-s1-double-booking` | == mp HEAD, clean, no obvious open issue | **VERIFY then remove** |
| `~/Dev/kuruma-marketplace-pivot` | `marketplace-pivot` | == origin HEAD, 2 untracked docs only | **KEEP** (integration worktree; up to date) |

### 1d. Branches
- Local `codex/marketplace-pivot-with-510` — 4 unpushed commits, no worktree/PR, dated 2026-06-09. **Owner inspect then delete.**
- Local `main` — divergent pre-pivot line; keep.
- Remote: ~133 branches linger (repo squash-merges and does not auto-delete; squashed branches aren't mp ancestors so don't show as "merged"). Clearest abandoned straggler: `origin/fix/security-and-perf` (2026-04-16, pre-pivot) → candidate for remote deletion. A periodic remote-branch prune of merged-PR heads would help, but is low priority.

### 1e. Issues & labels
- **Close `#523`** (operator/provider portal Vite re-port) — all 7 children (#524–#530) closed and shipping. Tracker is done.
- **Decide `#385`** (MVP epic) — acceptance met (8 slices closed, portal re-ported, #616 gap closed, demo e2e gate green). Close, or relabel "MVP-done" if kept as the ongoing umbrella.
- **Stale `in-progress` labels to review:** `#378` (Vite migration epic — effectively done/parked), `#423` (CF deploy dry-run — no branch/PR, likely not started). Verify and drop. `#394`/`#651` (location search) and `#647` (authz) appear genuinely active — leave.

---

## 2. Feature / progress picture (by area)

**Renter (7/7):** storefront-first cross-operator search + map/flat list (#513); reservation wizard + paid add-ons (#460); Stripe payment + payment_events (#461); booking + event log (#392); liability-disclaimer consent at checkout (#613/#632); "My Bookings" + nav (#543/#546); Vite login/OAuth (#510). Demo integration #509 ✅.

**Operator (8/8):** dashboard overview (#524); bookings calendar + filters + trip detail (#525/#549) — incl. **action-feedback refresh fix (#648, this session)**; fleet list/CRUD/photos + row↔grid (#526/#560/#561/#596); vehicle detail (#527); classes CRUD (#528); locations/storefronts (#529); pricing insurance+fees (#530); add-ons UI (#585); booking actions status/cancel/server-matched substitution + new-order badge (#616/#642/#619/#620); read-only gating for bypass roles (#583/#598); provider login → real dashboard (#624); `PATCH /status` operator-gated (#646).

**Admin:** platform admin portal in Vite (#552); partner revenue tab + `?month=` (#462/#628); demo payment_events seed (#627).

**Geocoding/location:** foundation (#531); global throttle (#574); distinguishable PENDING pin (#601-F6).

**Infra/CI:** multi-tab OAuth cookie fix (#519); fail-closed IP rate-limit (#563/#582); neon-serverless CI lane via local proxy (#496); authenticated real-DB e2e gate (#445) + per-page demo-walkthrough regression gate (#618/#637/#641); TCP-probe migrate-race fix (#636).

**Seed/demo:** add-on catalog (#635), payment_events (#639), turnaround floor + realistic seed (#551).

---

## 3. Tech-debt inventory

| Item | Severity | Where |
|---|---|---|
| `booking.ts` over soft cap | LOW | `packages/api/src/services/booking.ts` = 430 lines (cap 400; hard cap 800). Tracked indirectly by #518. |
| Large test file | LOW | `packages/api/tests/routes/bookings.test.ts` ≈ 1356 lines — consider splitting by concern. |
| Schema modular split | LOW/MED | `packages/shared/src/db/schema.ts` ≈ 816 lines (hard cap) — **#518** tracks the split. |
| Frozen `modules/` survivors | MED (latent) | `packages/web/src/modules/classes/api.ts` (carries a TODO) — live code lives in `src/vite/`. Grandfather policy: land a migration PR before non-trivial edits. |
| TODO/FIXME markers | negligible | 3 total across `packages/*/src` (classes/api.ts, booking.ts, fleet-overview.ts). |
| Type escape hatches | negligible | `as any`/`as never`/`@ts-expect-error`/`eslint-disable` = 0; 2 justified `biome-ignore` (a11y); 3 `as unknown` (api). Discipline is strong. |
| NativeSelect states | LOW | **#622** — `ui/native-select.tsx` lacks focus/disabled/aria-invalid states; now used by the substitute dialog too (#648). Harmonize globally. |
| Misc cleanups | LOW | #605 (extract `classToFormDefaults`), #456 (ClassForm operator-scope edit), #592 (cap OAuth flow cookies, P3), #634 (real-db harness wiring). |

**Standing constraints (from CLAUDE.md gotchas — not debt, but rules):** drizzle migration ordering (`db:verify`, never trust the `migrate` success line, bump `_journal.json` `when` on rebase); new i18n namespaces need a dev-server restart; CF Workers secrets set via `wrangler secret put` (dashboard wipes them) + AUTH_SECRET/DATABASE_URL must match API↔Web; `web` has no direct DB access (all via Hono API).

---

## 4. What to do next (proposed, prioritized)

1. **Bookkeeping (15 min, do first):** close #523; decide #385; drop stale `in-progress` on #378/#423. Clears the board so "open work" reflects reality.
2. **Repo cleanup (this doc's §1a–1b):** delete `txt` + `.gh640art/`; archive the ~25 DONE handoffs to `docs/archive/2026-06/`; commit the 4 KEEP docs. Leave worktrees to their owners (§1c).
3. **Next feature — renter location search (#651/#394).** Highest product value, has an approved design + build plan already in `docs/plans/`. The natural next build now the MVP is complete.
4. **Pre-launch hardening (parallelizable):** #423 (CF deploy dry-run — measure web bundle vs 10 MiB limit; gates real deploy), #361 (Sentry error/uptime monitoring), #508 (renter payment-return durability), #647 (finish booking-write role-model reconcile).
5. **Tech-debt paydown (opportunistic):** #518 (schema split), #622 (NativeSelect states), split `bookings.test.ts`, migrate the last frozen `modules/` survivors.

**Suggested immediate next step:** do #1 + #2 (fast, unblocks a clean picture), then start #651.

---

### Appendix — verification commands
```bash
git fetch origin && git log origin/marketplace-pivot -1 --oneline   # trunk tip
gh pr list --state open                                              # PR queue
git worktree list                                                    # re-check before §1c
bun run lint:size                                                    # size caps
bun run test && bun run lint                                         # green gate (note: i18n-parity/export-drift/dist-size are separate CI jobs)
```
