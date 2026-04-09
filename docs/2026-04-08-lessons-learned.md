# Lessons Learned — 2026-04-08

Issues encountered during the business dashboard shell implementation and their root causes.

---

## 1. Auth.js JWT does not re-fetch role from DB

**Symptom:** Changed user role to ADMIN in the database, but the app still treated the user as RENTER. Logging out and back in did not help.

**Root cause:** The Auth.js JWT callback only receives the `user` object on the *first* sign-in. On subsequent logins with an existing account, the callback runs but `user` is `undefined` -- so the role is never refreshed from the database.

```ts
// BROKEN: role only set once, never updated
jwt({ token, user }) {
  if (user) {
    token.role = user.role ?? 'RENTER'
  }
  return token
}
```

**Fix:** Query the DB for the current role on every JWT refresh:

```ts
// CORRECT: always fetch latest role
async jwt({ token, user }) {
  if (user) {
    token.role = user.role ?? 'RENTER'
  } else if (token.sub) {
    const [dbUser] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, token.sub))
      .limit(1)
    if (dbUser) {
      token.role = dbUser.role
    }
  }
  return token
}
```

**Rule:** Any field stored in the JWT that can change in the DB must be re-fetched in the JWT callback, not just set on first login.

---

## 2. next-intl message keys require dev server restart

**Symptom:** Added new i18n keys to `messages/en.json` (the `business.*` namespace). The page rendered raw key strings like `business.dashboard.title` instead of translated text.

**Root cause:** Next.js Turbopack caches the message JSON files via dynamic import. Adding new top-level namespaces to the JSON is not always picked up by HMR.

**Fix:** Clear the `.next` cache and restart the dev server:

```bash
rm -rf packages/web/.next && bun run dev
```

**Rule:** After adding new top-level i18n namespaces, always restart the dev server. Editing existing keys within an existing namespace usually hot-reloads fine.

---

## 3. CSS :has() rule did not hide duplicate navbar links

**Symptom:** Business users saw the same nav links in both the sidebar and the top navbar on desktop.

**Root cause:** The CSS `:has()` selector targets elements by their presence in the DOM, which works correctly. The actual issue was that the dev server cache had stale CSS. After clearing `.next`, the rule worked.

**Fix:** Same as #2 -- clear `.next` cache when CSS changes aren't reflected.

**Implementation note:** The pattern `[data-business-sidebar]` on the sidebar + `:root:has([data-business-sidebar]) [data-business-nav] { display: none }` in `globals.css` is a clean zero-JS approach for conditional layout. No React context needed for this specific case.

---

## 4. Full-height layout chain was broken

**Symptom:** Sidebar did not fill the full viewport height.

**Root cause:** The locale layout div had `h-full` but the root `<html>` and `<body>` elements had no height class. Tailwind's `h-full` resolves to `height: 100%`, which requires the parent to also have a defined height.

**Fix:** Added `className="h-full"` to `<html>` and `<body>` in `app/layout.tsx`, and changed the locale layout div from `h-full` to `min-h-dvh flex flex-col` (more robust, uses dynamic viewport height).

**Rule:** When using `h-full` in nested layouts, verify the height chain is unbroken from `<html>` down. Prefer `min-h-dvh` on the outermost app container -- it doesn't require parent height and handles mobile viewport correctly.

---

## 5. Zombie dev server processes cause crash loops

**Symptom:** Dev server showed repeated `next dev -p 3001` restarts and all RSC fetches returned pending/failed. The terminal showed `Failed to fetch RSC payload` errors in a loop.

**Root cause:** Multiple `next dev` processes were bound to the same port. One crashed, the other held the port, causing a fight. Can also happen when a previous test starts a server on a different port and doesn't clean up.

**Fix:**

```bash
# Kill all processes on the port
lsof -ti:3001 | xargs kill -9
# Also check for stray processes on other ports
kill <PID from the error message>
# Then restart clean
bun run dev
```

**Rule:** Before debugging "everything is broken" dev server issues, always check for zombie processes first: `lsof -ti:3001`.

---

## 6. Git history lost when parallel sessions force-push

**Symptom:** Dashboard shell commit existed on main, was pushed to remote, but disappeared after the API wiring branch merged.

**Root cause:** The API wiring session (running in a worktree) force-pushed or had a divergent history that overwrote the dashboard commit on main. The commit was orphaned but recoverable via `git log --all`.

**Fix:** Cherry-picked the orphaned commit: `git cherry-pick 66b2bf1`.

**Rule:** Never force-push to main. When parallel sessions work on different branches, merge (not rebase) to preserve all commits. Always check `git log --oneline -10` before pushing to verify your commits are present.

---

## 7. Stash conflicts during merge require careful resolution

**Symptom:** Stashed uncommitted changes (from the API session) conflicted with the layout-toggle branch during merge. The stash had a different approach (view-mode system via cookies) than the branch (layout preference via localStorage).

**Root cause:** Two independent features modified the same files (Navbar, NavbarClient) with different patterns. Stash pop after merge created conflicts.

**Fix:** Read both sides of the conflict, understood the intent of each (view-mode = which nav items to show; layout preference = sidebar vs topnav display), and merged both features manually.

**Rule:** Before stashing and merging, run `git stash show -p` to preview what the stash contains. If it touches the same files as your merge, resolve conflicts carefully by understanding both sides, not by blindly picking one.

---

## 8. Circular CSS Variable Caused Serif Font Fallback

**Symptom:** All text rendered in a serif font instead of Geist Sans.

**Root cause:** `globals.css` had `--font-sans: var(--font-sans)` -- a circular reference. The browser couldn't resolve it and fell back to the default serif font.

**Fix:** Changed to `--font-sans: var(--font-geist-sans)` which references the CSS variable set by `next/font/google` in the locale layout.

**Rule:** When adding `@theme inline` variables in Tailwind v4, always verify the right-hand side references an actual source variable, not itself.

---

## 9. Missing globals.css Import -- No CSS Loading

**Symptom:** Page rendered as unstyled HTML -- no CSS or JS hydration.

**Root cause:** The locale layout (`[locale]/layout.tsx`) had font classes but never imported `globals.css`. The CSS file existed but was orphaned.

**Fix:** Added `import '@/app/globals.css'` at the top of the locale layout.

**Rule:** When creating layouts in Next.js, always verify the CSS entry point is imported in the layout that renders the HTML shell.

---

## 10. .env Not Found by Next.js in Monorepo

**Symptom:** `DATABASE_URL is not set` error at runtime despite `.env` existing at repo root.

**Root cause:** Next.js reads `.env` from its own package directory (`packages/web/`), not the monorepo root.

**Fix:** Symlinked `packages/web/.env` -> `../../.env`.

**Rule:** In Bun workspace monorepos, symlink the root `.env` into each package that needs it.

---

## 11. Migrations Must Run Before Seeding

**Symptom:** Seed script failed with `PostgresError: relation "vehicles" does not exist`.

**Root cause:** `db:seed` was run before `db:migrate`. The vehicles table didn't exist yet.

**Fix:** Run `bun run db:migrate` first, then `bun run db:seed`.

**Rule:** Always migrate before seeding. The order is: `db:generate` -> `db:migrate` -> `db:seed`.

---

## 12. Merge Conflicts Silently Drop i18n Keys

**Symptom:** Vehicle detail page threw `MISSING_MESSAGE: Could not resolve 'vehicles.detail'`. Same happened with `bookings.new` keys.

**Root cause:** When resolving merge conflicts in JSON message files, one side's keys got silently dropped. Both branches added keys to the same `vehicles` object.

**Fix:** Manually re-added the missing keys after each merge.

**Rule:** After merging branches that both modify i18n files:
1. Verify ALL expected keys exist: `grep -c "detail\|filters\|new\|confirmation" packages/web/messages/en.json`
2. Re-read the fully merged file before committing
3. Consider splitting i18n by feature to reduce conflicts

---

## 13. Vehicles Page Lost Link Wrapping After Multi-Branch Merge

**Symptom:** Vehicle cards not clickable -- rendered as `<div>` instead of `<Link>`.

**Root cause:** Two branches modified the vehicles page: one added `<Link>` wrapping (detail page), the other added `searchParams` (search widget). The merge kept the search widget version which used `<div>`.

**Fix:** Rewrote the page to combine both: `<Link>` from detail branch + `searchParams` from search widget branch.

**Rule:** When merging branches that modify the same component, read the full merged result and verify all features from both branches are present. Don't just resolve conflict markers -- verify behavior.

---

## 14. API In-Memory Stores Don't Serve Seeded Data

**Symptom:** Seeded 15 vehicles into Postgres, but the API returned empty results.

**Root cause:** Hono API routes used in-memory `Map` stores, not the database.

**Fix:** Migrated all API routes to Drizzle/Postgres. Deleted `stores.ts`.

**Rule:** Don't mix data access patterns. If schema is in the DB, API must read from DB. In-memory stores are only for tests.

---

## 15. Neon Cold Start Causes Slow Booking Confirmation

**Symptom:** Booking confirmation took several minutes after clicking "Confirm".

**Root cause:** Neon serverless Postgres free tier suspends compute after inactivity. First connection takes 3-5s. Combined with server action overhead, this feels very slow.

**Fix (future):** Enable Neon connection pooling or switch to `@neondatabase/serverless` HTTP driver. For dev, keep DB warm with `db:studio` running.

**Rule:** Not a code issue -- infrastructure latency. Will resolve with connection pooling in production.

---

## 16. Edge-Safe Auth Config Missing JWT Callbacks — Business Nav Redirects to Home

**Symptom:** Logged in as ADMIN, but clicking any business nav link (Dashboard, Bookings, Fleet, etc.) redirected back to `/en`. Network tab showed 307 redirects on every nav click.

**Root cause:** Middleware uses `auth.config.ts` (edge-safe, no DB imports) for route protection. This config had providers only — no `callbacks`. The full `auth.ts` has JWT + session callbacks that set `session.user.role`, but middleware never sees those. So `session.user.role` was always `undefined` in middleware, and the business route check `!role || !BUSINESS_ROLES.has(role)` redirected to home.

**Fix:** Added JWT and session callbacks to `auth.config.ts` that pass role from token to session — without any DB imports:

```ts
// auth.config.ts (edge-safe)
callbacks: {
  jwt({ token, user }) {
    if (user) {
      token.role = (user as { role?: string }).role ?? 'RENTER'
    }
    return token
  },
  session({ session, token }) {
    if (session.user) {
      session.user.id = token.sub!
      ;(session.user as { role?: string }).role = (token.role as string) ?? 'RENTER'
    }
    return session
  },
}
```

The full `auth.ts` still re-fetches role from DB on token refresh (for role changes). The edge config just passes through what's already in the token.

**Rule:** When using split auth configs (edge-safe `auth.config.ts` + full `auth.ts`), any field the middleware needs to read from `session.user` must have callbacks in BOTH configs. The edge config can't query the DB, but it must still pass token fields through to the session.
