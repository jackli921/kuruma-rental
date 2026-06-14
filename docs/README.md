# Documentation index

This directory holds design docs, plans, and runbooks. Start here to tell
**canon** (source-of-truth, keep current) from **scratch** (superseded specs and
ephemeral session handoffs, kept only for history).

## Canonical — source of truth

| Doc | What |
|-----|------|
| [plans/2026-05-25-marketplace-mvp-proposal.md](plans/2026-05-25-marketplace-mvp-proposal.md) | **The** marketplace MVP plan (multi-tenant), 8-slice execution. Epic #385. |
| [plans/2026-04-07-architecture-redesign.md](plans/2026-04-07-architecture-redesign.md) | Architecture decisions (instant-book, hourly, monorepo) — still holds post-pivot. |
| [architecture/modules.md](architecture/modules.md) | Feature-module rules and the API layer boundaries (routes → services → repositories). |
| [plans/2026-04-09-cloudflare-deployment-lessons.md](plans/2026-04-09-cloudflare-deployment-lessons.md) | Cloudflare Workers deployment post-mortem and correct patterns. |
| [RUNBOOK.md](RUNBOOK.md) | Operational runbook. |
| [../packages/web/DESIGN.md](../packages/web/DESIGN.md) | Web design system (colors, typography, spacing, components). |

## Superseded — kept for history, do not follow

These predate the 2026-05-24 marketplace pivot. They stay in place (not archived)
because each is still referenced from history: `schema-api-design.md` is cited by a
merged, immutable migration (`drizzle/0006_exclusion_constraint.sql`), and
`kuruma-mvp-design.md` is cross-referenced by several frozen 2026-04 plan/spec docs.

| Doc | Superseded by |
|-----|---------------|
| [2026-04-02-kuruma-mvp-design.md](2026-04-02-kuruma-mvp-design.md) | The marketplace MVP proposal (above) — pre-pivot single-tenant spec. |
| [plans/2026-04-07-schema-api-design.md](plans/2026-04-07-schema-api-design.md) | Marketplace schema in the proposal §5 — pre-pivot schema. |

## Archive — ephemeral session/issue handoffs

Per-issue agent handoff notes are throwaway state, not documentation. They live under
[archive/](archive/) (grouped by month, e.g. `archive/2026-06/`) so the top level stays
canon-only. Reach for them only when reconstructing the history of a specific issue.
