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

The web shell (`packages/web/src/`) organizes UI by feature.

    src/modules/<feature>/
      api.ts         # typed hono/client calls to the API (web has NO direct DB access)
      components/    # feature components (VehicleForm, BookingCard, …)
      hooks.ts       # feature-specific hooks
      types.ts       # feature-local types
      index.ts       # the public surface (barrel)

- **Import only from the barrel: `@/modules/<feature>`.** Never reach into
  another feature's internals (`@/modules/foo/components/Bar`).
- Cross-feature primitives live in `src/lib/`. Design-system primitives stay in
  `src/components/ui/`.

> Note: `packages/web` was migrated off Next.js to **Vite + TanStack Router**
> (epic #378). The live shell is `src/vite/` + `src/routes/`; a frozen Next.js
> tree (`src/app/`) is still present but is not the build path — do not extend
> it. See the banner at the top of `AGENTS.md`.

### Enforcement

`scripts/lint-module-boundaries.ts` (a **root** script), run as:

```bash
bun run lint:modules   # also runs as part of `bun run lint`
```

It scans `packages/{api,web,shared}/src` and fails on any cross-module internal
import — i.e. importing `@/modules/<a>/<internal>` from a file in a different
module. (Its `@/`-alias matcher only fires for web's barrels; the API has no
`@/modules` imports, so it is effectively the web barrel guard.)

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

Some web features still live outside `src/modules/<feature>/` (legacy `lib/`
and `components/<feature>/` from before the module convention, plus the frozen
Next.js tree). They are exempt from the barrel rules until migrated. The
**file-size cap applies everywhere**.

**Migrate before you modify.** Before a non-trivial change to a grandfathered
*web* feature, land a standalone migration PR that moves it into
`src/modules/<feature>/`. The feature-change PR builds on top. Migrations and
feature changes never share a PR.

Trivial exceptions: typo fixes, one-line string tweaks, dependency bumps.

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

1. Create `packages/web/src/modules/<feature>/` with `api.ts`, `components/`,
   `hooks.ts`, `types.ts`, `index.ts`, and colocated tests.
2. Import from `@/modules/<feature>` in routes/pages. Never reach into internals.
3. Run `bun run lint` (includes `lint:modules` and `lint:size`).
