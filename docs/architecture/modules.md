# Architecture Rules & Fan-Out Discipline

This is the canonical rules doc for how code is organized across the monorepo.
The original design rationale lives in
`docs/superpowers/specs/2026-04-11-feature-modules-design.md`.

> **History.** The early-2026 plan was to organize *every* package by feature
> folder (`src/modules/<feature>/{routes,service,repo}.ts`). The API never
> adopted that shape — it settled on a layered **MVC + Dependency Injection**
> architecture instead, documented in `AGENTS.md` ("API Layer Architecture")
> and enforced by `packages/api/scripts/check-import-boundaries.ts`. This doc
> now describes what the code actually does. The `@/modules/<feature>` barrel
> convention still exists and is still enforced (see below), but only the web
> package uses it.

## The one-line rule

**A small semantic change should touch few files.** If you can't make a small
change without editing a dozen files, the architecture is wrong — fix the
architecture, don't fight it.

---

## packages/api — MVC + Dependency Injection (canonical)

The API is **not** organized by feature folder. It is organized by layer.
Source of truth: the `## API Layer Architecture (MVC + Dependency Injection)`
section in `AGENTS.md`.

    packages/api/src/
      routes/        # Controller layer: HTTP in/out only (one file per resource)
        helpers.ts   # ok() / fail() / parseBody() / parseDateRange() / pagination
      services/      # Service layer: business rules, validation, orchestration
      repositories/  # Data access: drizzle/ (prod), in-memory/ (tests), types.ts
        types.ts     # Repository *interfaces* — what services depend on
      index.ts       # Composition root: constructs concretes, wires DI, mounts routes
      lib/           # Cross-cutting pure helpers (booking-code, image-signature, …)
      middleware/    # Hono middleware (auth, csrf, logger, request-id)

> `packages/api/src/modules/` exists only as an empty `.gitkeep` placeholder.
> It is **not** the API's structure — do not create `modules/<feature>/`
> folders under the API. Add a resource as a layer-spread (a `routes/` file, a
> `services/` file, repository interfaces + implementations), not a folder.

### Import direction (the core rule)

**`routes/` → `services/` → `repositories/`. Never backwards.**

| Layer | May import | Must NOT import |
|-------|-----------|-----------------|
| `routes/*.ts` | services, `routes/helpers.ts`, repository *type* imports from `repositories/types` | concrete repositories (`repositories/drizzle`, `repositories/in-memory`) |
| `services/*.ts` | repository **interfaces** from `repositories/types` | concrete repository classes |
| `index.ts` (composition root) | concrete repositories + services + routes | — (it is the one place wiring is allowed) |

- **Routes are thin controllers.** They parse the request, call a service, and
  respond. No business logic.
- **Routes parse bodies via `parseBody(c, schema)`** from `routes/helpers.ts`,
  never `c.req.json()` directly — this keeps the `{ success, data | error }`
  envelope consistent. Build responses with `ok(c, data)` / `fail(c, error, status)`.
- **Services depend on interfaces, not implementations.** A service receives its
  repositories by injection so a test can pass an `InMemory*` double and prod
  can pass a `Drizzle*` one without changing the service.
- **Only the composition root may `new` a concrete repository.** Routes are factory
  functions (e.g. `createBookingRoutes(bookingService)`) chained onto the app
  via `.route('/', …)` inside `createApp()` in `index.ts`. There is no `app.ts`.
- **The one carve-out: transaction factories.** `repositories/drizzle/transaction.ts`
  and `operator-grant-transaction.ts` construct concrete repos directly, because each
  must rebind to the per-call neon-serverless transaction connection (#493) — something
  `index.ts` cannot do per call. They are the *only* files outside the composition root
  allowed to `new` a concrete; the boundary linter flags construction anywhere else.

### Enforcement

`packages/api/scripts/check-import-boundaries.ts`, run as:

```bash
bun run --filter @kuruma/api lint:boundaries
```

It is a CI step (`.github/workflows/ci.yml`) and flags:
1. a `routes/` file importing a concrete repository,
2. a `services/` file importing a concrete repository,
3. any non-composition-root file importing `repositories/drizzle` or `repositories/in-memory`,
4. a route calling `c.req.json()` instead of `parseBody()`,
5. a `new Drizzle*`/`new InMemory*` construction outside the composition root and the
   sanctioned `repositories/drizzle/*-transaction.ts` factories.

`*.test.ts` files are exempt — they legitimately construct concretes to exercise DI.

---

## packages/web — feature folders + barrel imports

The web shell (`packages/web/src/`) organizes UI by feature. There is **one
canonical home** for a web feature:

    src/modules/<feature>/        # CANONICAL — the home for every web feature
      api.ts         # typed hono/client calls to the API (web has NO direct DB access)
      schema.ts      # Zod schemas for API response bodies — large-DTO clients (#711/#785)
      components/    # feature components (VehicleForm, BookingCard, …)
      hooks.ts       # feature-specific hooks
      types.ts       # feature-local types
      index.ts       # the public surface (barrel)

- **Import only from the barrel: `@/modules/<feature>`.** Never reach into
  another feature's internals (`@/modules/foo/components/Bar`).
- Cross-feature primitives live in `src/lib/`. Design-system primitives stay in
  `src/components/ui/`.
- **Validate API responses at the seam.** `api.ts` calls `unwrap(res, schema)`
  (`@/lib/api-error`) so a drifted response body fails fast as a `ParseError`
  instead of surfacing as `undefined` deep in render (#711). For large-DTO
  clients (~25+ field responses, e.g. `operator-fleet`) the response schemas
  live in a sibling **`schema.ts`** with the DTO type inferred from each
  (`export type X = z.infer<typeof xSchema>`); small clients may keep schemas
  inline in `api.ts`. Draw enum members from the `@kuruma/shared/enums` tuples,
  never re-spelled string literals, so a renamed variant fails to compile.

> **`src/modules/` does not exist on disk yet.** Every live feature is still in
> `src/vite/` (below). The layout above is the *target*; the first feature
> drained out of `src/vite/` creates `src/modules/`. Until then, an
> `ls src/modules` returning nothing is expected — not staleness.

### Migration status: draining `src/vite/` into `src/modules/`

`packages/web` was migrated off Next.js to **Vite + TanStack Router** (epic
#378). The dead Next.js source trees (`src/app/`, the old `modules/`, dead
`components/<feature>/`, `nav/`, `actions/`, `hooks/`) were deleted in #704.
What remains alongside `src/routes/` (TanStack Router) and `src/components/ui/`
(design-system primitives) is **`src/vite/`** — a time-boxed **migration
staging tree** that holds live feature code until each feature is moved to its
canonical `src/modules/<feature>/` home.

**`src/vite/` and `src/components/<feature>/` are deprecated roots — do not add
new features there.** "Deprecated" means *no new features*, **not** frozen:
in-place fixes, refactors, and tweaks to existing `src/vite/` code are expected
and fine until that feature is drained. Drain them per-feature:

1. **One feature at a time.** Move `src/vite/<feature>/` (plus any
   `src/components/<feature>/` leftovers) into `src/modules/<feature>/` with the
   barrel layout above. Track each move as its own item.
2. **Same-PR deletion ratchet.** The PR that creates `src/modules/<feature>/`
   **deletes** the old `vite/` / `components/<feature>/` copies in the *same*
   PR — never leave two homes for one feature.
3. **No regrowth.** `lint:modules` carries a non-failing deprecation ratchet
   (`DEPRECATED_WEB_TREE_BASELINE`) that warns when the deprecated-tree file
   count grows past its baseline. After a drain, refresh it in place with
   `bun run scripts/lint-module-boundaries.ts --update-baseline`.

### Enforcement

`scripts/lint-module-boundaries.ts` (a **root** script), run as:

```bash
bun run lint:modules   # also runs as part of `bun run lint`
```

It scans `packages/{api,web,shared}/src` and enforces three rules:
1. **No cross-module internal imports** — importing `@/modules/<a>/<internal>`
   from a file in a different module fails. (Its `@/`-alias matcher only fires
   for web's barrels; the API has no `@/modules` imports, so it is effectively
   the web barrel guard.)
2. **No web runtime DB access (#722)** — a non-`type` import of `@/lib/db`,
   `@kuruma/shared/db`, or `drizzle-orm` anywhere under `packages/web/src`
   fails, unconditionally (#714 removed the Auth.js carve-out — web no longer
   runs Auth.js). `import type` is always allowed (erased at build).
3. **Deprecated-tree ratchet (#719)** — a non-failing warning when the file
   count under `src/vite/` or `src/components/<feature>/` grows past
   `DEPRECATED_WEB_TREE_BASELINE` (see migration status above).

---

## packages/shared

No feature-folder structure. Schema and validators already live in per-feature
files (`db/schema.ts`, `validators/<feature>.ts`). Import from `@kuruma/shared/*`.

---

## File-size rules (everywhere)

`scripts/lint-file-size.ts`, run as `bun run lint:size` (also part of
`bun run lint` and the pre-commit hook):

- **Soft warn at 400 lines, hard fail at 800 lines** for source files.

---

## Grandfather / migrate-before-you-modify policy

Most web features currently live in the `src/vite/` staging tree (see migration
status above); a few legacy bits remain in `src/lib/`. These are exempt from the
barrel rules until migrated. The **file-size cap applies everywhere**.

**Migrate before you modify.** Before a non-trivial change to a feature still in
`src/vite/` (or a legacy `components/<feature>/` / `lib/` spot), land a
standalone migration PR that moves it into `src/modules/<feature>/`. The
feature-change PR builds on top. Migrations and feature changes never share a PR.

Trivial exceptions: typo fixes, one-line string tweaks, dependency bumps.

While `src/modules/` is still empty, "migrate" means creating a feature's first
canonical home — so this rule activates per-feature as drains begin, not as a
blanket tax on the whole `src/vite/` tree today.

> This policy is about the **web** module convention. The API is already
> uniformly layered; "migrating" an API resource means keeping it within the
> `routes/services/repositories` layers and respecting the import direction —
> not moving it into a `modules/` folder.

---

## How to add an API resource

1. Add `packages/api/src/routes/<resource>.ts` — a factory function
   (`create<Resource>Routes(service)`) that parses via `parseBody` and responds
   via `ok` / `fail`.
2. Add `packages/api/src/services/<resource>.ts` for the business logic,
   depending only on repository interfaces from `repositories/types.ts`.
3. Add the repository interface to `repositories/types.ts` and its
   implementations under `repositories/drizzle/` and `repositories/in-memory/`.
4. Wire it in `index.ts`: construct the concrete repo + service, then chain
   `.route('/', create<Resource>Routes(service))` onto the app in `createApp()`.
5. Run `bun run --filter @kuruma/api lint:boundaries` and `bun run lint`.

## How to add a web feature

1. Create `packages/web/src/modules/<feature>/` (the canonical home — **not**
   `src/vite/`; you create `src/modules/` itself if you are the first feature
   drained out) with `api.ts`, `components/`, `hooks.ts`, `types.ts`,
   `index.ts`, and colocated tests.
2. Import from `@/modules/<feature>` in routes/pages. Never reach into internals.
3. Run `bun run lint` (includes `lint:modules` and `lint:size`).
