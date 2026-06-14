# Docs index

How this directory is organized, so canon is easy to find and ephemeral notes stay out of the way (#730).

## Source of truth

| Doc | What |
|-----|------|
| [`plans/2026-05-25-marketplace-mvp-proposal.md`](plans/2026-05-25-marketplace-mvp-proposal.md) | **Marketplace MVP plan** — the canonical spec (epic #385). |
| [`plans/2026-04-07-architecture-redesign.md`](plans/2026-04-07-architecture-redesign.md) | Architecture decisions (instant-book, hourly, monorepo). |
| [`architecture/modules.md`](architecture/modules.md) | Feature-module rules (enforced by `lint:modules`). |
| [`architecture/booking-authz.md`](architecture/booking-authz.md) | Booking write-path authorization model. |
| [`plans/2026-04-09-cloudflare-deployment-lessons.md`](plans/2026-04-09-cloudflare-deployment-lessons.md) | CF Workers deployment post-mortem + correct patterns. |
| [`cloudflare-developer-guide.md`](cloudflare-developer-guide.md) | CF developer guide. |
| [`RUNBOOK.md`](RUNBOOK.md) · [`CONTRIB.md`](CONTRIB.md) | Ops runbook · contributor guide. |
| [`runbooks/2026-demo-runbook.md`](runbooks/2026-demo-runbook.md) | Demo walkthrough runbook. |

The web design system lives in [`packages/web/DESIGN.md`](../packages/web/DESIGN.md).

Active design plans live in [`plans/`](plans/). Some pre-pivot plans are marked **_Superseded_** at the top and kept for history — read the marker before treating one as current.

## Conventions

- **`handoffs/`** — ephemeral per-session/issue agent working state. **Gitignored** (local only); not canon. Don't commit handoffs to the tracked tree — older committed ones live in `archive/`.
- **`archive/<YYYY-MM>/`** — historical committed handoffs and superseded session notes, kept for provenance but out of the top level.
