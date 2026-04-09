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

_None currently in progress._

## Blocked

| Issue | Blocker |
|-------|---------|
| #9 CF Workers postgres-js | Needs @neondatabase/serverless driver swap; partially started |

## Up Next (Priority Order)

1. **#10** Fix missing `vehicles.detail` i18n keys in en.json (quick bug fix)
2. **#7** Vehicle management CRUD — Fleet page (Phase 1 core slice)
3. **#8** Wire dashboard stat cards to real API data
4. **#9** CF Workers deployment fix

## Recently Completed

| Date | What |
|------|------|
| 2026-04-08 | Business dashboard shell (sidebar, pages, i18n) |
| 2026-04-08 | Layout preference toggle (sidebar vs top nav) |
| 2026-04-08 | Auth.js JWT role re-fetch fix |
| 2026-04-08 | Lessons learned doc + CLAUDE.md gotchas |
| 2026-04-07 | Hono API skeleton, vehicle/booking routes |
| 2026-04-07 | Landing page, nav bar, role-based routing |
| 2026-04-07 | Monorepo split, Biome setup |

---

*Last updated: 2026-04-08 by business-dashboard-shell session*
