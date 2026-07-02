# Fleet timeline: deliberate `react-calendar-timeline` pre-release pin

Decision record for #1330. Date: 2026-07-02.

## TL;DR

The fleet planning board (`FleetTimeline`, #1100/#1204) is pinned to **`react-calendar-timeline@0.30.0-beta.18`** — a pre-release — **on purpose**.
There is no stable release to move to, so #1330's "upgrade to a stable release" is not achievable today.
Do not "fix" the pin to a `^`/`~` range or a `0.28.x` stable: `0.28.0` predates React 18/19 and will not run under our React 19.

## What #1330 asked

Before `VITE_FEATURE_FLEET_TIMELINE` is flipped ON in a paid/GA build, either (1) upgrade to a stable
`react-calendar-timeline` release, or (2) pin deliberately and document the accessibility follow-up.

## What the registry actually offers (checked 2026-07-02)

- Our React: **19.2.4**.
- `react-calendar-timeline` newest **stable**: **`0.28.0`** (React 16/17 era). Everything after is `0.30.0-beta.*` — the
  React-18/19 compatibility line, which **never went stable**.
- Newest published version of any kind: **`0.30.0-beta.18`** — which is exactly what we already run, and it is already an
  **exact pin** (no range) in `packages/web/package.json`. Last upstream publish: 2026-03-04 (effectively stalled).
- `interactjs@1.10.27` (drag/resize backend) is already the latest.

So option 1 is impossible — we are already on the newest thing that exists, and React-19 compatibility is proven in
practice (the board renders and its e2e passes; the lib is code-split into its own lazy chunk per the #1099 perf commit,
so it ships to nobody until the flag turns on).

## The decision (option 2)

Keep the deliberate exact pin. The one real risk that remains is **accessibility**: the timeline bars are
**mouse/pointer only** — no keyboard navigation and no ARIA labelling on the bars. That is tracked as **#1349** and
**gates flipping `VITE_FEATURE_FLEET_TIMELINE` on for GA** (a paid build needs a keyboard-navigable, screen-reader-labelled
path to the same information — either added to the bars, or satisfied by the existing accessible list/quick-view calendar
as the fallback).

The only path to a genuinely maintained upgrade would be swapping to a different timeline library or a maintained fork —
out of scope for #1330; revisit if the accessibility work in #1349 turns out cheaper to get by replacing the lib.

Refs: #1330 (this record), #1349 (a11y gate), #1099 (code-split), #1100 / #1204 (the board).
