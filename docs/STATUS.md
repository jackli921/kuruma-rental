# Project Status

> **Updated by each Claude Code session.** Read this + `gh issue list` at session start. Update before session end.

## Quick Commands

```bash
# See all open issues
gh issue list

# See issues by label
gh issue list --label slice
gh issue list --label bug
gh issue list --label infra

# See milestone progress
gh issue list --milestone "Phase 1: Core Booking"

# Claim an issue (assign to yourself -- use any name)
gh issue edit <number> --add-label "in-progress"

# Close when done
gh issue close <number>
```

## Active Work

| Worktree | Branch | Issue |
|----------|--------|-------|
| `kuruma-dashboard-stats` | `feat/dashboard-stats` | #8 Wire dashboard stat cards |
| `kuruma-fleet-crud` | `feat/fleet-crud` | #7 Vehicle management CRUD |
| `kuruma-fleet-fixes` | `fix/fleet-review` | Fleet review fixes |

## Blocked

| Issue | Blocker |
|-------|---------|
| #9 CF Workers postgres-js | Needs @neondatabase/serverless driver swap |

## Up Next (Priority Order)

1. **#16** Availability filtering — search dates filter vehicle listing
2. **#11** Business calendar dashboard
3. **#9** CF Workers deployment fix
4. **#12** DM threads (customer messaging)
5. **#13** 3rd-party booking API (Trip.com)
6. **#14** Cancellation policy enforcement

## Recently Completed

| Date | What |
|------|------|
| 2026-04-09 | Fix bookings review issues (image config, i18n badge, JST dates, redirect) |
| 2026-04-09 | #15 My bookings page with TDD (status badge, vehicle join, card list) |
| 2026-04-08 | Booking flow end-to-end (book form, availability check, confirmation) |
| 2026-04-08 | Vehicle detail page, search widget, API DB migration (parallel agents) |
| 2026-04-08 | Landing page redesign (Airbnb-inspired), vehicle seed data, photos schema |
| 2026-04-08 | Font fix, CSS import, layout fixes, admin/renter view toggle |
| 2026-04-08 | Edge auth config fix (JWT callbacks in auth.config.ts) |
| 2026-04-08 | Lessons learned doc, Cloudflare developer guide, CLAUDE.md gotchas |
| 2026-04-08 | Business dashboard shell, layout preference toggle |
| 2026-04-07 | Hono API skeleton, vehicle/booking routes |
| 2026-04-07 | Landing page, nav bar, role-based routing |
| 2026-04-07 | Monorepo split, Biome setup |

---

*Last updated: 2026-04-09 by main session (bookings review fixes + cleanup)*
