# Handoff — Canonical MVP complete + certified (2026-06-13)

**Trunk:** `marketplace-pivot` @ `8d911bb`. **Zero open PRs.** Every step of the
owner's canonical screenshot plan (商家端 1–8 + 游客端 1–7, the "上线计划 按流程顺序")
is merged and proven green end-to-end on a real Postgres.

## Certification (how to re-prove it)
```bash
git worktree add ../kuruma-mvp-certify -b chore/mvp-certify origin/marketplace-pivot
cd ../kuruma-mvp-certify && bun install
bun run test:e2e:real-db:local      # disposable postgres:16; needs Docker
```
Last run (mp@8d911bb): **5/5 passed (29.0s)** — `demo-walkthrough.auth.spec.ts`
walks every operator + renter page incl. `03b-op-vehicle-detail` and
`04b-op-trip-detail` (booking actions); `marketplace-happy-path.auth.spec.ts`
runs search → storefront → vehicle → booking → confirmation → operator sees it.
The lane's readiness race was fixed in PR #636 (TCP probe), so it's reliable.
Gotchas: Playwright cache `~/Library/Caches/ms-playwright`; local API DB =
`packages/api/.dev.vars`; the real-db lane (not the mock `test:e2e`) is the proof.

## Canonical coverage map

### 商家端 Operator (8 steps)
| # | Step | Covered by (issue → merged PR) |
|---|------|--------------------------------|
| 1 | Provider login | #521 provider-auth; landing fix #623→PR #624 (`b8bae6d`) |
| 2 | Storefront + 48h turnaround | locations #529→#575; turnaround-60min-floor #551→#572 |
| 3 | Vehicles (fleet CRUD) | foundation #526 + slices #555–560→PR #584; grid toggle #561→#597; select-all #596→#612; vehicle-detail #527→#629 |
| 4 | Per-vehicle day/hour price | VehicleForm fields (part of #526 fleet); luggage/size wiring #504→#606 |
| 5 | Insurance options | #530→PR #578 (`/manage/insurance`) |
| 6 | Fees | #530→PR #578 (`/manage/fees`); classes CRUD #528→#567; add-ons #585→#602 |
| 7 | New-order email alert + 红点 badge | `OPERATOR_BOOKING_ALERT` email (slice 7); in-app red-dot #611→PR #620 (`e29fb75`) |
| 8 | 故障车换同级别车 + 留痕 (substitute + audit) | substitution UI #610→PR #619 (`df9710c`); full booking actions (status/cancel/server-matched substitute) #616→PR #642 (`9df6e7b`); status-gate hardening #643→PR #646 (`8d911bb`) |

Supporting operator surface: dashboard #524→#586; bookings calendar/detail #525→#590.

### 游客端 Renter (7 steps)
| # | Step | Covered by |
|---|------|------------|
| 1 | Login (Google/Apple OAuth) | #510; multi-tab OAuth race fix #519→#593 |
| 2 | Search (date + location) | #458; class/location carry-forward #499→#562 |
| 3 | Storefront list + vehicle detail | #458 / #391 |
| 4 | Booking wizard (insurance + add-ons) | #460 |
| 5 | Instant-book + confirmation | #511; liability-disclaimer consent at checkout #613→PR #632 (`d4bac5b`) |
| 6 | Confirmation email (zh/en/ja) | #393 (renter.language threads locale) |
| 7 | Pay-at-pickup (offline) | by design — no online payment in MVP |

## What's next (nothing canonical remains)
1. **#423 — OpenNext/CF Workers deploy dry-run**: measure web bundle vs the
   10 MiB limit. First real gate toward a production deploy. The TanStack
   route-export warnings in the cert logs hint the bundle wants attention.
2. **`kuruma-616-followup`** (branch `fix/616-trip-detail-stale-after-action`):
   live, owner-driven — trip-detail timeline not refreshing after an action.
   Pure UX polish; let it land, don't touch.
3. Other non-canonical follow-ups (all filed, none blocking): #621 ACRISS match,
   #628 `?month=` (merged), #622 NativeSelect states, #605 classToFormDefaults,
   #487 revoke legacy STAFF/ADMIN, #500 enforce CSP, #508 payment durability.

## Hard rules (carry forward)
- **Never enter/edit a worktree you didn't create** — `git status` + newest mtime
  first; <15 min or unknown untracked = sibling live, STOP.
- Merges to mp: require-up-to-date → `update-branch` → poll CI → squash; base≠default
  → close issue + drop label manually. No force-push; `rm` not `rm -f`.
- Owner wants canonical-only — the MVP is done, so new work is opt-in (deploy or polish).
- In a fast swarm, **first green + mergeable PR wins**; verify which branch holds the
  PR before trusting a label (this session saw a #642↔#644 dup whipsaw both ways).
