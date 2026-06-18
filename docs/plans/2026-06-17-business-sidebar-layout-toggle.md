# Business-view sidebar layout toggle — design

- **Date:** 2026-06-17
- **Status:** Draft (rev 2 — incorporates review P1/P2a/P2b) — awaiting review
- **Type:** Bug fix that completes an orphaned feature (frontend, `packages/web`)
- **Related:** #481 (original Next.js sidebar feature), #378/#497 (Vite migration that dropped the consumer), `_admin` portal (working reference)
- **Tracking issue:** _to be created before implementation_

## Summary

The business/operator portal has a navbar button that is supposed to toggle the
nav between a **top bar** and a **left sidebar**. Clicking it does nothing: the
nav stays at the top. Root cause is not a logic bug — it is an **orphaned
feature**. The toggle button, the preference state (+ localStorage), and the CSS
hide-rule all exist, but **the component that reads the preference and renders a
sidebar was never built** in the Vite app. This doc designs the missing consumer.

## Problem & root cause (verified)

The layout chain has four parts. Three exist; the fourth is missing:

| Part | Status | Evidence |
|------|--------|----------|
| Toggle button | ✅ exists | `vite/nav/NavbarClient.tsx:17-30` (`LayoutToggle`), rendered only in business view (`:39`) |
| Preference state + persistence | ✅ exists | `vite/LayoutPreferenceProvider.tsx` — `'sidebar' \| 'topnav'`, default `'sidebar'` (`:11`), localStorage `kuruma-layout-preference` |
| CSS hide-rule for top links | ✅ exists | `styles/globals.css:221-224` — `:root:has([data-business-sidebar]) [data-business-nav] { display: none }` |
| **Sidebar consumer that reads the preference** | ❌ **missing** | No component renders `data-business-sidebar`; the only reader of `preference` is the button itself (icon color + tooltip). `routes/$locale/_business.tsx:24` is a bare `component: Outlet`. |

**The broken chain:**

```
click → toggle() → setPreference + localStorage  ✅
                 → (icon color / tooltip update)  ✅
                 → ❌ NOTHING reads preference to render a sidebar
                 → ❌ data-business-sidebar never enters the DOM
                 → ❌ CSS rule never matches → top nav never hidden, no sidebar
```

**Working reference:** the admin portal does this correctly and is the pattern to
mirror. `routes/$locale/_admin.tsx:29-38` uses an `AdminLayout` that always
renders `<AdminSidebar/>`; `AdminSidebar` emits `data-admin-sidebar` and a
sibling CSS rule hides the global navbar. The business portal needs the same
shape, but **conditional on the preference** instead of always-on.

**Origin:** the Vite migration (#378/#497) ported the toggle, the provider, and
the CSS rule from the #481-era Next.js feature, but not the sidebar component.

## Goals

1. Clicking the toggle visibly switches the operator nav between top bar and left
   sidebar, and the choice persists across reloads with no first-paint flash.
2. In sidebar mode the nav links live in the sidebar (no duplicate top links).
3. Match the existing `AdminSidebar` look/behavior for visual consistency.
4. Accessibility: `aria-current="page"` active state (correct on nested routes),
   semantic `<nav>`/`<aside>`.
5. Business chrome only ever shows in business view, even on a `_business` route.

## Non-goals

- No backend / API / schema changes (this is presentation-only).
- No new feature flag — this fixes existing (broken) UI, it is not a new gated feature.
- No icons in the sidebar for v1 (keeps the shared nav array untouched; see Decisions).
- No mobile redesign — mobile keeps the existing `MobileMenu`.
- **Not** fixing the pre-existing "renter top-chrome on a business page" wart
  holistically (see Follow-ups) — this slice only prevents the *sidebar* from
  contributing to that mismatch.

## Design

### Component tree (sidebar mode, business view, md+)

```
$locale.tsx
  LayoutPreferenceProvider
    Navbar                         ← always on top: logo, locale, toggle, user menu
      <nav data-business-nav>      ← hidden by CSS when sidebar present
    _business → BusinessLayout
      <div flex md:flex-row>
        BusinessSidebar            ← NEW: <aside data-business-sidebar>
        <main><Outlet/></main>
```

### Closed, view-aware data flow

```
toggle() → preference (context) → BusinessLayout reads useLayoutPreference() + getViewMode(role)
  preference==='sidebar' AND viewMode==='business'
        → render <BusinessSidebar/> (emits data-business-sidebar)
        → CSS hides top [data-business-nav] links
  otherwise (topnav, OR renter view on a business route)
        → render plain <Outlet/> (no sidebar; top chrome as-is)
```

### New: `vite/nav/BusinessSidebar.tsx`

Mirrors `AdminSidebar.tsx` with these differences:

- Emits `data-business-sidebar=""` (load-bearing — drives the CSS rule).
- Renders `visibleBusinessNavItems()` (from `vite/nav/business-nav-items.ts`),
  which already applies the team/settings feature-flag gating. Labels resolve via
  `useTranslations('nav')` + `item.labelKey` — **the keys already exist** in
  en/ja/zh (the top navbar uses the same source), so no new nav i18n keys.
- The `/manage/bookings` item carries the new-bookings badge via
  `useNewBookingsBadge({ enabled: true })` (same hook the navbar uses), for parity.
- **Active state — default (non-exact) matching (review P2a).** Use
  `activeProps={{ 'aria-current': 'page' }}` with the `aria-[current=page]:*`
  Tailwind variants, but **do NOT copy admin's `activeOptions={{ exact: true }}`**.
  Business items have detail children (`manage/bookings/$bookingId`,
  `manage/fleet/$vehicleId`), so exact matching would drop the active state on
  detail routes. Default prefix matching keeps the parent item active on its
  children. Verified safe: no `to` value is a prefix of another, so there is no
  false-active collision (admin needs `exact` only because `/admin` is a prefix
  of `/admin/revenue`).
- **md+ only** (`hidden md:flex md:flex-col w-56 …`); styling otherwise copied
  from `AdminSidebar`.

### Change: `routes/$locale/_business.tsx` (view-aware, review P1)

Replace `component: Outlet` with a `BusinessLayout` that reads BOTH the preference
and the current view mode, so the sidebar never renders for an operator who has
switched to renter view while still on a business route:

```tsx
function BusinessLayout() {
  const { preference } = useLayoutPreference()
  const { data: session } = useSession()
  const showSidebar = preference === 'sidebar' && getViewMode(session?.user?.role) === 'business'
  if (showSidebar) {
    return (
      <div className="flex flex-col md:flex-row flex-1">
        <BusinessSidebar />
        <main className="flex-1 min-w-0"><Outlet /></main>
      </div>
    )
  }
  return <Outlet />
}
```

(Guard `beforeLoad`/`pendingComponent` unchanged.)

### Change: `vite/LayoutPreferenceProvider.tsx` (no init flash, review P2b)

The provider currently initialises to `DEFAULT_PREFERENCE` and reads localStorage
in a `useEffect`. With no consumer that was invisible; once `BusinessLayout`
consumes the preference, a stored-`topnav` user would render the sidebar first and
flip after mount — a visible flash on every load. Fix: read localStorage in a
**lazy `useState` initializer** (synchronous) and drop the effect:

```tsx
function readStoredPreference(): LayoutPreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'sidebar' || stored === 'topnav' ? stored : DEFAULT_PREFERENCE
}
// ...
const [preference, setPreference] = useState<LayoutPreference>(readStoredPreference)
```

Safe because this is a client-only SPA render (no SSR, no hydration mismatch).

### Change: `vite/nav/NavbarClient.tsx`

The toggle `title` is currently a hardcoded English string. Replace with i18n:
two new keys under the `nav` namespace (`nav.switchToSidebar` / `nav.switchToTopNav`)
in en/ja/zh.

### Responsive behavior

- The top business `<nav>` is already `hidden md:flex`; `MobileMenu` handles <md.
- `BusinessSidebar` is **md+ only**, so on mobile it never duplicates `MobileMenu`.
- `data-business-sidebar` is still in the DOM on mobile (element is
  `display:none`, not unmounted), so the CSS still hides the top `[data-business-nav]`
  — harmless, since those links are already hidden <md and `MobileMenu` is separate.

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default preference | Keep `'sidebar'` | Matches admin; better for the ~10-item operator nav. **Note:** operators with no stored preference see the sidebar by default on next load (intended). |
| Preference init | Lazy `useState` (sync localStorage read) | No first-paint flash now that a consumer exists. SPA → safe (P2b). |
| Sidebar gating | `preference==='sidebar' && viewMode==='business'` | View is cookie-driven and decoupled from route; an operator in renter view on a business route must not get business chrome (P1). |
| Active matching | Default (non-exact), unlike admin | Business items have detail children; exact would drop active state on detail routes (P2a). |
| Mobile | Sidebar is md+ only | Avoids a second mobile nav alongside `MobileMenu`. |
| Icons | None in v1 | `business-nav-items.ts` has no `icon` field; adding one touches a shared SSoT used by 3 consumers. Labels-only ships the fix; icons are a clean follow-up. |
| Feature flag | None | This is a fix to broken existing UI, not a new gated feature. |

## Files changed

- **new** `packages/web/src/vite/nav/BusinessSidebar.tsx`
- **new** `packages/web/src/vite/nav/BusinessSidebar.test.tsx` (sidebar + layout/toggle tests)
- **change** `packages/web/src/routes/$locale/_business.tsx` (Outlet → view-aware BusinessLayout)
- **change** `packages/web/src/vite/LayoutPreferenceProvider.tsx` (lazy init, drop effect)
- **change** `packages/web/src/vite/nav/NavbarClient.tsx` (tooltip i18n)
- **change** `packages/web/messages/{en,ja,zh}.json` (2 `nav` keys)

## Test plan (TDD — repro first, mutation-resistant)

1. **Repro the bug (red → green):** render the business shell (business view) with
   `preference='topnav'` → assert no `data-business-sidebar` and top nav links
   present; flip to `'sidebar'` (or click the toggle) → assert `data-business-sidebar`
   is in the DOM and the sidebar nav links render.
2. **BusinessLayout — preference gate:** renders `<BusinessSidebar/>` iff
   `preference==='sidebar'`; otherwise renders only the outlet content.
3. **BusinessLayout — view gate (P1):** with `preference='sidebar'` but the
   `kuruma-view` cookie = `renter` (operator in renter view) on a business route →
   assert NO `data-business-sidebar` (sidebar suppressed).
4. **BusinessSidebar — contents:** renders exactly `visibleBusinessNavItems()`
   labels; hides Team/Settings when those flags are off; shows the bookings badge
   when `newBookingsCount > 0`.
5. **BusinessSidebar — nested active (P2a):** on `/manage/bookings/$bookingId`,
   the Bookings item has `aria-current="page"` (would FAIL under `exact: true`).
6. **Provider — no flash (P2b):** with localStorage pre-set to `'topnav'`, the
   FIRST committed render is topnav (no `data-business-sidebar`) — i.e. no
   default-`sidebar`-then-flip.
7. **Tooltip i18n:** the toggle `title` resolves from the `nav` namespace (assert
   the resolved string, not the key).

**Testing caveat:** jsdom does not evaluate the `:has()` CSS selector, so unit
tests assert the **DOM contract** (presence/absence of `data-business-sidebar` and
the rendered links), not the visual hiding of the top links. The CSS-driven hide
is verified by the rule already existing + a manual/E2E check in the running app.

## Edge cases & risks

- **Default flip:** existing operators move to the sidebar on next load. Intended;
  called out so it is not a surprise. They switch back via the now-working toggle.
- **View ≠ route (P1):** `UserMenu.handleSwitchView` flips the `kuruma-view` cookie
  and `router.invalidate()`s without navigating, and `businessGuard` keys off role,
  so an operator can be in renter view on a `_business` route. The view-gate above
  ensures the sidebar (business chrome) is suppressed in that state. The residual
  renter-top-chrome-on-business-page is pre-existing and out of scope here (Follow-ups).
- **Double nav:** prevented by the existing CSS rule; the repro/layout tests assert
  the data-attribute contract that the rule depends on.
- **SSR:** none (SPA); the lazy localStorage read at init is client-only and safe.

## Follow-ups (out of scope for this slice)

- **Navigate on view switch:** make `UserMenu.handleSwitchView` navigate to the
  view-appropriate home (renter → `/$locale/search`, business → `/$locale/dashboard`)
  so a user is never stranded on a route that doesn't match their view. Fixes the
  pre-existing renter-chrome-on-business-page wart that predates this slice.
- **Sidebar icons:** add an `icon` field to `business-nav-items.ts` and render it,
  matching `AdminSidebar`'s visual density.

## Rollout

- No flag, no migration. Ships as a normal frontend PR to `develop`.
- Manual/E2E smoke after merge: in business view, click the toggle, confirm the
  nav moves between top and side and persists across reload with no flash.

## Process

1. Worktree off `origin/develop`: `~/Dev/kuruma-business-sidebar`, branch `feat/business-sidebar`.
2. Create the tracking issue (root cause + this design as the body).
3. TDD in the order above (repro test first).
4. `code-reviewer` agent pass.
5. PR → `develop`, `Closes #<issue>`.

## Revision history

- **rev 2 (2026-06-17):** incorporated review — P1 view-aware sidebar gating + test,
  P2a non-exact active matching + nested-route test, P2b lazy-init to kill the flash
  + test. Added Follow-ups (navigate-on-switch, icons).
- **rev 1 (2026-06-17):** initial design.
