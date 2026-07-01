# Operator Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public self-serve operator registration flow — a rental business submits a form, it is quarantined as an `operator_applications` row, a platform admin reviews it, and approval atomically provisions a live operator + an owner invite.

**Architecture:** Untrusted public input never touches the `operators` table. The public `POST /operator-applications` writes only to a new quarantine table. Admin approve runs a single transaction (mirroring `RunOperatorGrant`) that guards against an email already owning an operator (C1), creates the operator, mints an `OPERATOR_OWNER` provider invite, and flips the application to APPROVED — all-or-nothing, idempotent. Reject and approve emit durable audit events.

**Tech Stack:** Hono + drizzle (packages/api), drizzle schema + zod + enums SSoT (packages/shared), TanStack Router + react-hook-form + use-intl (packages/web). Runtime: Bun. Tests: Vitest (api + web unit/integration), Playwright (e2e).

**Design source:** GitHub issue #1277 (v4). This plan folds in all review + architecture findings: C1 (cross-aggregate orphan guard), H1 (OWNER role), the tx-bundle shape, invite payload completeness, dedup DB invariant, named-constraint 409, enums SSoT, audit enum migration, wrangler limiter parity.

---

## Conventions (read once)

- **Worktree:** `/Users/jack/kuruma-rental-1277`, branch `feat/1277-operator-registration` (off `origin/develop`). All paths below are relative to the repo root.
- **Run a single API test:** from `packages/api`: `../../node_modules/.bin/vitest run <path> -t "<name>"`. Full api suite: `../../node_modules/.bin/vitest run`.
- **Run a web test:** from `packages/web`: `../../node_modules/.bin/vitest run <path>`.
- **NEVER** `bunx vitest` / `bunx biome` (pulls incompatible latest). Use `node_modules/.bin/*`.
- **Typecheck per package:** `cd packages/{shared,api,web} && bun run typecheck`.
- **Migrations:** after editing `packages/shared/src/db/**`, run from repo root `bun run db:generate`, then inspect the new `drizzle/NNNN_*.sql` and commit it. Migrations are committed SQL. `bun run db:migrate` applies (needs `DATABASE_URL`; CI neon-tx exercises real DB).
- **Lint gates (CI):** `lint:i18n-parity` (en/ja/zh key parity), `lint:unwrap-schema` (web `unwrap(res, schema)` must carry a schema), `lint:module-boundaries`, `lint:size` (file-size cap), `lint:fk-indexes` (every FK needs a covering index). Mirror existing modules to stay green.
- **Commit style:** Conventional Commits, e.g. `feat(#1277): <slice>`. Commit after every green task.
- **Error envelope:** services throw `ConflictError`/`NotFoundError` (from `../auth/guards`); the global `app.onError` (`error-handlers.ts`) maps them (409/404). Success envelope is `{ success: true, data }`; failure `{ success: false, error }`.

## File structure

**packages/shared (create):**
- `src/db/operator-applications.ts` — table + its 3 pgEnums (status, fleet size, business type).
- `src/validators/operator-application.ts` — shared zod schema (form + API).
**packages/shared (modify):**
- `src/enums.ts` — add `OPERATOR_APPLICATION_STATUSES`, `OPERATOR_APPLICATION_FLEET_SIZES`, `OPERATOR_APPLICATION_BUSINESS_TYPES`.
- `src/enums.test.ts` — pin the new arrays (order-contractual).
- `src/db/schema.ts` — re-export the new table module.

**packages/api (create):**
- `src/repositories/in-memory/operator-application.ts`, `src/repositories/drizzle/operator-application.ts`.
- `src/repositories/drizzle/operator-approval-transaction.ts` — the `RunOperatorApproval` runner.
- `src/services/operator-application.ts` (+ `.test.ts`) — submit/list/reject/approve.
- `src/services/invite-mint.ts` — shared invite-token/URL helper (extracted, M1).
- `src/routes/operator-applications.ts` — public POST.
- `tests/routes/operator-applications.test.ts`, `tests/routes/admin-operator-applications.test.ts`.
**packages/api (modify):**
- `src/stores.ts` — `OperatorApplication` row type.
- `src/repositories/types.ts` — `OperatorApplicationRepository` + re-export tx types.
- `src/repositories/types-transactions.ts` — `OperatorApprovalRepos` + `RunOperatorApproval`.
- `src/repositories/in-memory/index.ts`, `src/repositories/drizzle/index.ts` — barrels.
- `src/composition/repositories.ts` — `Repos` bundle + 3 builders + approval runner.
- `src/pg-errors.ts` — `OPERATOR_APPLICATION_EMAIL_CONSTRAINT`.
- `src/services/provider-invite.ts` — use the extracted `invite-mint` helper.
- `src/services/audit.ts`, `packages/shared/src/db/audit.ts` — 2 new audit kinds + variants + `toAuditRow`.
- `src/index.ts` — service + routes + limiter wiring; app-level gate stays OFF the public path.
- `src/routes/admin.ts` (or a new `admin-operator-applications.ts`) — admin list/reject/approve routes.
- `packages/api/wrangler.toml` — new `OPERATOR_APPLICATION_LIMITER` ratelimit binding.

**packages/web (create):**
- `src/vite/operator-registration/{api.ts, OperatorRegistrationForm.tsx, RegistrationSuccess.tsx}`.
- `src/routes/$locale/business/register.tsx` — public route.
- `src/vite/admin/operator-applications/{api.ts, ApplicationsReviewView.tsx, ApplicationReviewCard.tsx}`.
- `src/routes/$locale/_admin/admin/operator-applications.tsx`.
- tests colocated + under `tests/vite/**`.
**packages/web (modify):**
- `src/vite/nav/AdminSidebar.tsx` — nav entry.
- `messages/{en,ja,zh}.json` — `business.register.*` + `admin.applications.*` + `admin.nav.applications`.
- `src/vite/landing/*` — "List your business" CTA.

---

# SLICE 1 — Data foundation + public submission (API)

Delivers: `POST /operator-applications` persists a PENDING row, honeypot + rate limit + dedup 409, fully tested. No web yet.

### Task 1.1: Add the three closed-set enums to the SSoT

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/enums.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `packages/shared/src/enums.test.ts` (mirror the existing order-contractual assertions):

```ts
import {
  OPERATOR_APPLICATION_STATUSES,
  OPERATOR_APPLICATION_FLEET_SIZES,
  OPERATOR_APPLICATION_BUSINESS_TYPES,
} from './enums'

describe('operator application enums', () => {
  it('pins application status order (ALTER TYPE ADD VALUE appends positionally)', () => {
    expect(OPERATOR_APPLICATION_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })
  it('pins fleet-size buckets', () => {
    expect(OPERATOR_APPLICATION_FLEET_SIZES).toEqual(['1-5', '6-20', '21-50', '50+'])
  })
  it('pins business types', () => {
    expect(OPERATOR_APPLICATION_BUSINESS_TYPES).toEqual(['INDIVIDUAL', 'COMPANY'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** From `packages/shared`: `../../node_modules/.bin/vitest run src/enums.test.ts` — Expected: FAIL (imports undefined).

- [ ] **Step 3: Implement.** Add to `packages/shared/src/enums.ts` (near the other operator sets, ~line 119):

```ts
export const OPERATOR_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type OperatorApplicationStatus = (typeof OPERATOR_APPLICATION_STATUSES)[number]

export const OPERATOR_APPLICATION_FLEET_SIZES = ['1-5', '6-20', '21-50', '50+'] as const
export type OperatorApplicationFleetSize = (typeof OPERATOR_APPLICATION_FLEET_SIZES)[number]

export const OPERATOR_APPLICATION_BUSINESS_TYPES = ['INDIVIDUAL', 'COMPANY'] as const
export type OperatorApplicationBusinessType = (typeof OPERATOR_APPLICATION_BUSINESS_TYPES)[number]
```

- [ ] **Step 4: Run, verify pass.** Same command — Expected: PASS.

- [ ] **Step 5: Commit.** `git add packages/shared/src/enums.ts packages/shared/src/enums.test.ts && git commit -m "feat(#1277): operator-application enum SSoT"`

### Task 1.2: Drizzle table module + migration

**Files:**
- Create: `packages/shared/src/db/operator-applications.ts`
- Modify: `packages/shared/src/db/schema.ts`
- Create (generated): `drizzle/NNNN_operator_applications.sql`

- [ ] **Step 1: Write the table module.** Mirror `renter-documents.ts` exactly (lazy FK thunk, own module for the size cap, array-return index callback). Create `packages/shared/src/db/operator-applications.ts`:

```ts
import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import {
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
  OPERATOR_APPLICATION_STATUSES,
} from '../enums'
import { operators } from './auth'

// Public self-serve operator registration (#1277). QUARANTINE table: untrusted
// form input lands here and NEVER touches `operators` until a platform admin
// approves. Approval provisions the operator + an OPERATOR_OWNER invite in one tx
// and links `operatorId` back here. Own module (not schema.ts) to keep the
// aggregate schema file under the size cap; re-exported from schema.ts so
// drizzle-kit discovers it. `operators` FK uses a lazy () => thunk.
export const operatorApplicationStatusEnum = pgEnum(
  'operator_application_status',
  OPERATOR_APPLICATION_STATUSES,
)
export const operatorApplicationFleetSizeEnum = pgEnum(
  'operator_application_fleet_size',
  OPERATOR_APPLICATION_FLEET_SIZES,
)
export const operatorApplicationBusinessTypeEnum = pgEnum(
  'operator_application_business_type',
  OPERATOR_APPLICATION_BUSINESS_TYPES,
)

export const operatorApplications = pgTable(
  'operator_applications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    status: operatorApplicationStatusEnum('status').notNull().default('PENDING'),
    businessName: text('businessName').notNull(),
    contactName: text('contactName').notNull(),
    // Stored lowercased at the boundary; the provider-invite target on approval.
    contactEmail: text('contactEmail').notNull(),
    contactPhone: text('contactPhone').notNull(),
    serviceArea: text('serviceArea').notNull(),
    estimatedFleetSize: operatorApplicationFleetSizeEnum('estimatedFleetSize').notNull(),
    website: text('website'),
    businessLicenseNumber: text('businessLicenseNumber'),
    businessType: operatorApplicationBusinessTypeEnum('businessType'),
    message: text('message'),
    submittedLocale: text('submittedLocale').notNull(),
    // Set in the approval tx. onDelete restrict — an approved app must not be
    // silently orphaned by an operator delete (matches memberships/invites).
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    reviewedByUserId: text('reviewedByUserId'),
    reviewedAt: timestamp('reviewedAt', { withTimezone: true }),
    reviewerNotes: text('reviewerNotes'),
    rejectionReason: text('rejectionReason'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Admin queue filters on status; ordering by createdAt.
    index('idx_operator_applications_status').on(t.status),
    // FK-covering index (lint:fk-indexes).
    index('idx_operator_applications_operatorId').on(t.operatorId),
    // THE dedup invariant: at most one live application per email, covering BOTH
    // PENDING and APPROVED so there is no gap during the PENDING->APPROVED flip.
    // REJECTED rows leave the set, so a rejected applicant may re-apply. Emails
    // are lowercased at the boundary, so a plain column suffices.
    uniqueIndex('operator_applications_live_email_unique')
      .on(t.contactEmail)
      .where(sql`status in ('PENDING','APPROVED')`),
  ],
)
```

- [ ] **Step 2: Re-export from schema.** Add to `packages/shared/src/db/schema.ts` (named export line, like `renter-documents` at :26):

```ts
export {
  operatorApplications,
  operatorApplicationStatusEnum,
  operatorApplicationFleetSizeEnum,
  operatorApplicationBusinessTypeEnum,
} from './operator-applications'
```

- [ ] **Step 3: Generate the migration.** From repo root: `bun run db:generate`. Expected: a new `drizzle/NNNN_*.sql` creating 3 types, the table, the 2 indexes, and the partial unique index with `WHERE status in ('PENDING','APPROVED')`.

- [ ] **Step 4: Verify the generated SQL.** Open the new file; confirm `CREATE TABLE "operator_applications"`, the three `CREATE TYPE`, and `CREATE UNIQUE INDEX "operator_applications_live_email_unique" ... WHERE status in ('PENDING','APPROVED')`. Run `cd packages/shared && bun run typecheck` — Expected: clean.

- [ ] **Step 5: Commit.** `git add packages/shared/src/db/operator-applications.ts packages/shared/src/db/schema.ts drizzle/ && git commit -m "feat(#1277): operator_applications table + migration"`

### Task 1.3: Shared zod validator

**Files:**
- Create: `packages/shared/src/validators/operator-application.ts`
- Create: `packages/shared/src/validators/operator-application.test.ts`

- [ ] **Step 1: Failing test.** Create `operator-application.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { operatorApplicationSchema } from './operator-application'

const valid = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko Tanaka',
  contactEmail: 'AIKO@Example.com',
  contactPhone: '+81 90-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  consent: true,
  submittedLocale: 'en',
  website: '',
}

describe('operatorApplicationSchema', () => {
  it('accepts a valid application and lowercases the email', () => {
    const r = operatorApplicationSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.contactEmail).toBe('aiko@example.com')
  })
  it('rejects when consent is false', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, consent: false })
    expect(r.success).toBe(false)
  })
  it('rejects a bad fleet-size bucket', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, estimatedFleetSize: '999' })
    expect(r.success).toBe(false)
  })
  it('coerces an empty website to undefined', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, website: '' })
    expect(r.success && r.data.website).toBeUndefined()
  })
  it('rejects a javascript: website (httpUrl refine)', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, website: 'javascript:alert(1)' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail.** From `packages/shared`: `../../node_modules/.bin/vitest run src/validators/operator-application.test.ts` — FAIL.

- [ ] **Step 3: Implement.** Create `packages/shared/src/validators/operator-application.ts` (email lowercased like `provider-invite.ts`; enums from SSoT; `httpUrl` from `./url`; `consent` must be literal true; `honeypot` optional-empty; note `httpUrl` can't take `.max()` — compose if needed):

```ts
import { z } from 'zod'
import {
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
} from '../enums'
import { LOCALES } from './locales' // if no such module, inline z.enum(['en','ja','zh'])
import { httpUrl } from './url'

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

export const operatorApplicationSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(100),
  contactEmail: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Must be a valid email')
    .transform((v) => v.toLowerCase()),
  contactPhone: z.string().trim().min(3).max(40),
  serviceArea: z.string().trim().min(1).max(120),
  estimatedFleetSize: z.enum(OPERATOR_APPLICATION_FLEET_SIZES),
  website: z.preprocess(emptyToUndefined, httpUrl.optional()),
  businessLicenseNumber: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  businessType: z.enum(OPERATOR_APPLICATION_BUSINESS_TYPES).optional(),
  message: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  submittedLocale: z.enum(['en', 'ja', 'zh']),
  // Anti-spam bot trap — must be empty. Not persisted.
  honeypot: z.string().max(0).optional(),
  // Consent gate — must be checked.
  consent: z.literal(true),
})

export type OperatorApplicationInput = z.infer<typeof operatorApplicationSchema>
```

> Note: if `./locales` doesn't exist, inline `z.enum(['en','ja','zh'])` as shown and drop the import.

- [ ] **Step 4: Run, verify pass.** Same command — PASS. Then `cd packages/shared && bun run typecheck` — clean.

- [ ] **Step 5: Commit.** `git add packages/shared/src/validators/operator-application.ts packages/shared/src/validators/operator-application.test.ts && git commit -m "feat(#1277): operator-application zod schema"`

### Task 1.4: Row type + repository interface

**Files:**
- Modify: `packages/api/src/stores.ts`
- Modify: `packages/api/src/repositories/types.ts`

- [ ] **Step 1: Add the row type.** In `packages/api/src/stores.ts` (near the other operator rows), import the enum types from `@kuruma/shared/enums` and add:

```ts
export interface OperatorApplication {
  id: string
  status: OperatorApplicationStatus
  businessName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  serviceArea: string
  estimatedFleetSize: OperatorApplicationFleetSize
  website: string | null
  businessLicenseNumber: string | null
  businessType: OperatorApplicationBusinessType | null
  message: string | null
  submittedLocale: string
  operatorId: string | null
  reviewedByUserId: string | null
  reviewedAt: Date | null
  reviewerNotes: string | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 2: Add the repository interface.** In `packages/api/src/repositories/types.ts` (import `OperatorApplication` from `../stores`), add:

```ts
export interface OperatorApplicationRepository {
  /** Insert a PENDING application. Throws UNIQUE_VIOLATION on the live-email
   *  partial index (named OPERATOR_APPLICATION_EMAIL_CONSTRAINT) → service 409. */
  create(
    data: Omit<
      OperatorApplication,
      'id' | 'status' | 'operatorId' | 'reviewedByUserId' | 'reviewedAt' | 'reviewerNotes' | 'rejectionReason' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<OperatorApplication>
  findById(id: string): Promise<OperatorApplication | undefined>
  /** Admin queue. Optional status filter; newest first. */
  list(status?: OperatorApplicationStatus): Promise<OperatorApplication[]>
  /** Idempotency + claim+link (approval tx step): UPDATE ... SET status='APPROVED',
   *  operatorId, reviewedByUserId, reviewedAt WHERE id=? AND status='PENDING'
   *  RETURNING row. Returns undefined when 0 rows matched (already reviewed). */
  markApprovedIfPending(
    id: string,
    operatorId: string,
    reviewedByUserId: string,
    reviewedAt: Date,
  ): Promise<OperatorApplication | undefined>
  /** REJECTED terminal write. WHERE id=? AND status='PENDING'. */
  markRejectedIfPending(
    id: string,
    reviewedByUserId: string,
    reviewedAt: Date,
    rejectionReason: string,
  ): Promise<OperatorApplication | undefined>
}
```

- [ ] **Step 3: Typecheck.** `cd packages/api && bun run typecheck` — Expected: FAIL only at composition/barrels (no impls yet) — that's fine, next tasks add them. If it fails for other reasons (typos), fix. (No standalone test here; this is a type contract.)

- [ ] **Step 4: Commit.** `git add packages/api/src/stores.ts packages/api/src/repositories/types.ts && git commit -m "feat(#1277): OperatorApplication row + repository interface"`

### Task 1.5: In-memory repository

**Files:**
- Create: `packages/api/src/repositories/in-memory/operator-application.ts`
- Modify: `packages/api/src/repositories/in-memory/index.ts`
- Create: `packages/api/src/repositories/in-memory/operator-application.test.ts`

- [ ] **Step 1: Failing test.** Create the test (inject a `Map`, mirror provider-invite in-memory test style):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { OperatorApplication } from '../../stores'
import { InMemoryOperatorApplicationRepository } from './operator-application'

const base = {
  businessName: 'A', contactName: 'B', contactEmail: 'x@y.com', contactPhone: '090',
  serviceArea: 'Osaka', estimatedFleetSize: '1-5' as const, website: null,
  businessLicenseNumber: null, businessType: null, message: null, submittedLocale: 'en',
}

describe('InMemoryOperatorApplicationRepository', () => {
  let store: Map<string, OperatorApplication>
  let repo: InMemoryOperatorApplicationRepository
  beforeEach(() => { store = new Map(); repo = new InMemoryOperatorApplicationRepository(store) })

  it('creates a PENDING row', async () => {
    const a = await repo.create(base)
    expect(a.status).toBe('PENDING')
    expect(store.size).toBe(1)
  })
  it('rejects a duplicate live email with a UNIQUE_VIOLATION carrying the named constraint', async () => {
    await repo.create(base)
    await expect(repo.create(base)).rejects.toMatchObject({ code: '23505' })
  })
  it('allows re-apply after the prior app is not live (rejected)', async () => {
    const a = await repo.create(base)
    await repo.markRejectedIfPending(a.id, 'admin', new Date(), 'no')
    await expect(repo.create(base)).resolves.toMatchObject({ status: 'PENDING' })
  })
  it('markApprovedIfPending returns undefined on a second call', async () => {
    const a = await repo.create(base)
    expect(await repo.markApprovedIfPending(a.id, 'op1', 'admin', new Date())).toBeTruthy()
    expect(await repo.markApprovedIfPending(a.id, 'op1', 'admin', new Date())).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify fail.** From `packages/api`: `../../node_modules/.bin/vitest run src/repositories/in-memory/operator-application.test.ts` — FAIL.

- [ ] **Step 3: Implement.** Create `operator-application.ts` (constructor takes optional `Map`; emulate the live-email partial unique via `Object.assign(new Error(...), { code, constraint_name })`, mirroring the provider-invite in-memory impl):

```ts
import { OPERATOR_APPLICATION_EMAIL_CONSTRAINT, PG_ERROR } from '../../pg-errors'
import type { OperatorApplication } from '../../stores'
import type { OperatorApplicationRepository } from '../types'
import type { OperatorApplicationStatus } from '@kuruma/shared/enums'

const LIVE = new Set<OperatorApplicationStatus>(['PENDING', 'APPROVED'])
type CreateData = Parameters<OperatorApplicationRepository['create']>[0]

export class InMemoryOperatorApplicationRepository implements OperatorApplicationRepository {
  private readonly store: Map<string, OperatorApplication>
  constructor(store?: Map<string, OperatorApplication>) {
    this.store = store ?? new Map()
  }

  private assertNoLiveDuplicate(email: string): void {
    const target = email.toLowerCase()
    const clash = [...this.store.values()].some(
      (a) => LIVE.has(a.status) && a.contactEmail.toLowerCase() === target,
    )
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint_name: OPERATOR_APPLICATION_EMAIL_CONSTRAINT,
      })
    }
  }

  async create(data: CreateData): Promise<OperatorApplication> {
    this.assertNoLiveDuplicate(data.contactEmail)
    const now = new Date()
    const app: OperatorApplication = {
      ...data,
      id: crypto.randomUUID(),
      status: 'PENDING',
      operatorId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewerNotes: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(app.id, app)
    return app
  }

  async findById(id: string): Promise<OperatorApplication | undefined> {
    return this.store.get(id)
  }

  async list(status?: OperatorApplicationStatus): Promise<OperatorApplication[]> {
    return [...this.store.values()]
      .filter((a) => !status || a.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
  }

  async markApprovedIfPending(id: string, operatorId: string, reviewedByUserId: string, reviewedAt: Date) {
    const a = this.store.get(id)
    if (!a || a.status !== 'PENDING') return undefined
    const next: OperatorApplication = { ...a, status: 'APPROVED', operatorId, reviewedByUserId, reviewedAt, updatedAt: new Date() }
    this.store.set(id, next)
    return next
  }

  async markRejectedIfPending(id: string, reviewedByUserId: string, reviewedAt: Date, rejectionReason: string) {
    const a = this.store.get(id)
    if (!a || a.status !== 'PENDING') return undefined
    const next: OperatorApplication = { ...a, status: 'REJECTED', reviewedByUserId, reviewedAt, rejectionReason, updatedAt: new Date() }
    this.store.set(id, next)
    return next
  }
}
```

- [ ] **Step 4: Barrel + run.** Add to `in-memory/index.ts`: `export { InMemoryOperatorApplicationRepository } from './operator-application'`. Run the test — PASS.

- [ ] **Step 5: Commit.** `git add packages/api/src/repositories/in-memory/operator-application.ts packages/api/src/repositories/in-memory/index.ts packages/api/src/repositories/in-memory/operator-application.test.ts && git commit -m "feat(#1277): in-memory operator-application repo"`

### Task 1.6: Drizzle repository

**Files:**
- Create: `packages/api/src/repositories/drizzle/operator-application.ts`
- Modify: `packages/api/src/repositories/drizzle/index.ts`

- [ ] **Step 1: Implement** (mirror `drizzle/provider-invite.ts`: `$inferSelect` Row, `toOperatorApplication` mapper, `constructor(private readonly db: Db)`, `.returning()`, conditional `.where`). Create `operator-application.ts`:

```ts
import { operatorApplications } from '@kuruma/shared/db/schema'
import type { OperatorApplicationStatus } from '@kuruma/shared/enums'
import { and, desc, eq } from 'drizzle-orm'
import type { OperatorApplication } from '../../stores'
import type { OperatorApplicationRepository } from '../types'
import type { Db } from './shared'

type Row = typeof operatorApplications.$inferSelect
type CreateData = Parameters<OperatorApplicationRepository['create']>[0]

function toOperatorApplication(r: Row): OperatorApplication {
  return { ...r }
}

export class DrizzleOperatorApplicationRepository implements OperatorApplicationRepository {
  constructor(private readonly db: Db) {}

  async create(data: CreateData): Promise<OperatorApplication> {
    const [row] = await this.db.insert(operatorApplications).values(data).returning()
    if (!row) throw new Error('Failed to insert operator application')
    return toOperatorApplication(row)
  }

  async findById(id: string): Promise<OperatorApplication | undefined> {
    const [row] = await this.db.select().from(operatorApplications).where(eq(operatorApplications.id, id))
    return row ? toOperatorApplication(row) : undefined
  }

  async list(status?: OperatorApplicationStatus): Promise<OperatorApplication[]> {
    const rows = await this.db
      .select()
      .from(operatorApplications)
      .where(status ? eq(operatorApplications.status, status) : undefined)
      .orderBy(desc(operatorApplications.createdAt), operatorApplications.id)
    return rows.map(toOperatorApplication)
  }

  async markApprovedIfPending(id: string, operatorId: string, reviewedByUserId: string, reviewedAt: Date) {
    const [row] = await this.db
      .update(operatorApplications)
      .set({ status: 'APPROVED', operatorId, reviewedByUserId, reviewedAt, updatedAt: new Date() })
      .where(and(eq(operatorApplications.id, id), eq(operatorApplications.status, 'PENDING')))
      .returning()
    return row ? toOperatorApplication(row) : undefined
  }

  async markRejectedIfPending(id: string, reviewedByUserId: string, reviewedAt: Date, rejectionReason: string) {
    const [row] = await this.db
      .update(operatorApplications)
      .set({ status: 'REJECTED', reviewedByUserId, reviewedAt, rejectionReason, updatedAt: new Date() })
      .where(and(eq(operatorApplications.id, id), eq(operatorApplications.status, 'PENDING')))
      .returning()
    return row ? toOperatorApplication(row) : undefined
  }
}
```

> If `toOperatorApplication(r) { return { ...r } }` fails typecheck (Row nullability vs interface), map fields explicitly like `drizzle/provider-invite.ts`.

- [ ] **Step 2: Barrel.** Add to `drizzle/index.ts`: `export { DrizzleOperatorApplicationRepository } from './operator-application'`.

- [ ] **Step 3: Typecheck.** `cd packages/api && bun run typecheck` — still failing only at composition (repo not in bundle yet). Proceed.

- [ ] **Step 4: Commit.** `git add packages/api/src/repositories/drizzle/operator-application.ts packages/api/src/repositories/drizzle/index.ts && git commit -m "feat(#1277): drizzle operator-application repo"`

### Task 1.7: Named constraint constant

**Files:** Modify `packages/api/src/pg-errors.ts`

- [ ] **Step 1: Add the constant** (mirror `PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT` doc-comment style):

```ts
/**
 * Partial unique index on operator_applications(contactEmail) WHERE status in
 * ('PENDING','APPROVED') (#1277). At most one LIVE application per email; a
 * REJECTED row frees the slot so a rejected applicant can re-apply. A 23505 on
 * this name means a duplicate live application → translated to a 409.
 */
export const OPERATOR_APPLICATION_EMAIL_CONSTRAINT = 'operator_applications_live_email_unique'
```

- [ ] **Step 2: Typecheck + commit.** `cd packages/api && bun run typecheck`; then `git add packages/api/src/pg-errors.ts && git commit -m "feat(#1277): operator-application email constraint constant"`

### Task 1.8: OperatorApplicationService.submit + composition wiring

**Files:**
- Create: `packages/api/src/services/operator-application.ts` (+ `.test.ts`)
- Modify: `packages/api/src/composition/repositories.ts` (Repos bundle + 3 builders)

- [ ] **Step 1: Wire the repo into composition first** (so the service can be constructed). In `repositories.ts`: add `operatorApplicationRepo: OperatorApplicationRepository` to the `Repos` interface; construct in all three builders:
  - `buildInMemoryRepos`: `const operatorApplicationRepo = new InMemoryOperatorApplicationRepository()`
  - `buildOverrideRepos`: `const operatorApplicationRepo = overrides.operatorApplicationRepo ?? new InMemoryOperatorApplicationRepository()`
  - `buildDrizzleRepos`: `const operatorApplicationRepo = new DrizzleOperatorApplicationRepository(db)`
  - Return `operatorApplicationRepo,` in each bundle. Also add `operatorApplicationRepo?` to `AppOverrides` (find the overrides type, likely `app-overrides.ts`).

- [ ] **Step 2: Failing service test.** Create `services/operator-application.test.ts` (construct in-memory repo directly, inject a `Map`):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryOperatorApplicationRepository } from '../repositories/in-memory/operator-application'
import { OperatorApplicationService } from './operator-application'

const input = {
  businessName: 'Osaka Rentals', contactName: 'Aiko', contactEmail: 'aiko@example.com',
  contactPhone: '+81 90', serviceArea: 'Osaka', estimatedFleetSize: '6-20' as const,
  website: undefined, businessLicenseNumber: undefined, businessType: undefined,
  message: undefined, submittedLocale: 'en',
}

describe('OperatorApplicationService.submit', () => {
  let repo: InMemoryOperatorApplicationRepository
  let service: OperatorApplicationService
  beforeEach(() => { repo = new InMemoryOperatorApplicationRepository(); service = makeService(repo) })

  it('persists a PENDING application and returns {id,status}', async () => {
    const r = await service.submit(input)
    expect(r).toMatchObject({ status: 'PENDING' })
    expect(r.id).toMatch(/[0-9a-f-]{36}/)
  })
  it('throws ConflictError on a duplicate live email', async () => {
    await service.submit(input)
    await expect(service.submit(input)).rejects.toThrow('already') // ConflictError message
  })
})

function makeService(repo: InMemoryOperatorApplicationRepository) {
  return new OperatorApplicationService(repo)
}
```

- [ ] **Step 3: Run, verify fail.** From `packages/api`: `../../node_modules/.bin/vitest run src/services/operator-application.test.ts` — FAIL.

- [ ] **Step 4: Implement the service** (translate the named 23505 → `ConflictError`, mirroring `provider-invite.ts:96-108`). Create `services/operator-application.ts`:

```ts
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { ConflictError } from '../auth/guards'
import { OPERATOR_APPLICATION_EMAIL_CONSTRAINT, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { OperatorApplication } from '../stores'
import type { OperatorApplicationRepository } from '../repositories/types'

// The honeypot/consent fields are validated + stripped at the route boundary; the
// service persists only the domain fields (contactEmail already lowercased by zod).
type SubmitInput = Omit<OperatorApplicationInput, 'honeypot' | 'consent'>

export class OperatorApplicationService {
  constructor(private readonly repo: OperatorApplicationRepository) {}

  async submit(input: SubmitInput): Promise<Pick<OperatorApplication, 'id' | 'status'>> {
    try {
      const app = await this.repo.create({
        businessName: input.businessName,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        serviceArea: input.serviceArea,
        estimatedFleetSize: input.estimatedFleetSize,
        website: input.website ?? null,
        businessLicenseNumber: input.businessLicenseNumber ?? null,
        businessType: input.businessType ?? null,
        message: input.message ?? null,
        submittedLocale: input.submittedLocale,
      })
      return { id: app.id, status: app.status }
    } catch (err) {
      if (
        pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION &&
        pgConstraintName(err) === OPERATOR_APPLICATION_EMAIL_CONSTRAINT
      ) {
        throw new ConflictError('an application or account already exists for this email')
      }
      throw err
    }
  }
}
```

- [ ] **Step 5: Run, verify pass; typecheck.** Test PASS; `cd packages/api && bun run typecheck` clean (all builders now supply the repo).

- [ ] **Step 6: Commit.** `git add packages/api/src/services/operator-application.ts packages/api/src/services/operator-application.test.ts packages/api/src/composition/repositories.ts packages/api/src/app-overrides.ts && git commit -m "feat(#1277): OperatorApplicationService.submit + composition wiring"`

### Task 1.9: Public route + honeypot + rate limiter + wiring

**Files:**
- Create: `packages/api/src/routes/operator-applications.ts`
- Create: `packages/api/tests/routes/operator-applications.test.ts`
- Modify: `packages/api/src/index.ts`, `packages/api/wrangler.toml`

- [ ] **Step 1: Failing route test.** Create `tests/routes/operator-applications.test.ts` (uses `createApp({ operatorApplicationRepo })` + `app.request`, mirrors `provider-invites.test.ts`):

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryOperatorApplicationRepository } from '../../src/repositories/in-memory'
import { setupAuthEnv } from '../helpers/auth'

const valid = {
  businessName: 'Osaka Rentals', contactName: 'Aiko', contactEmail: 'aiko@example.com',
  contactPhone: '+81 90-1234-5678', serviceArea: 'Osaka', estimatedFleetSize: '6-20',
  submittedLocale: 'en', consent: true,
}

function makeApp() {
  setupAuthEnv()
  const operatorApplicationRepo = new InMemoryOperatorApplicationRepository()
  const app = createApp({ operatorApplicationRepo })
  return { app, operatorApplicationRepo }
}

describe('POST /operator-applications', () => {
  let app: ReturnType<typeof makeApp>['app']
  beforeEach(() => { ({ app } = makeApp()) })
  const post = (body: unknown) => app.request('/operator-applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  test('201 persists a pending application', async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, data: { status: 'PENDING' } })
  })
  test('400 on invalid body (missing consent)', async () => {
    const res = await post({ ...valid, consent: false })
    expect(res.status).toBe(400)
  })
  test('honeypot filled → 400 (silent bot reject)', async () => {
    const res = await post({ ...valid, honeypot: 'i-am-a-bot' })
    expect(res.status).toBe(400)
  })
  test('duplicate live email → 409', async () => {
    await post(valid)
    const res = await post(valid)
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run, verify fail.** `../../node_modules/.bin/vitest run tests/routes/operator-applications.test.ts` — FAIL (404/no route).

- [ ] **Step 3: Implement the route.** Create `packages/api/src/routes/operator-applications.ts` (public; optional limiter; `parseBody`; honeypot rejects via the schema's `honeypot: z.string().max(0)`, so a filled honeypot is a 400 automatically):

```ts
import { operatorApplicationSchema } from '@kuruma/shared/validators/operator-application'
import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import type { OperatorApplicationService } from '../services/operator-application'
import { ok, parseBody } from './helpers'
import { rateLimitByIp } from './rate-limit'

export function createOperatorApplicationRoutes(
  service: OperatorApplicationService,
  limiter?: RateLimitBinding,
) {
  const app = new Hono()
  if (limiter) app.use('/operator-applications', rateLimitByIp(limiter))
  return app.post('/operator-applications', async (c) => {
    const parsed = await parseBody(c, operatorApplicationSchema)
    if (!parsed.ok) return parsed.response
    const { honeypot: _h, consent: _c, ...data } = parsed.data
    const result = await service.submit(data)
    return ok(c, result, 201)
  })
}
```

> Confirm `ok(c, data, status)` supports a status arg (see `admin.ts:33` `ok(c, ..., 201)`); if the helper differs, match its signature.

- [ ] **Step 4: Wire in `index.ts`.** (a) Resolve the limiter near the others (~:164): `const operatorApplicationLimiter = overrides?.operatorApplicationLimiter ?? ((globalThis as Record<string, unknown>).OPERATOR_APPLICATION_LIMITER as RateLimitBinding | undefined)`. (b) Construct the service: `const operatorApplicationService = new OperatorApplicationService(operatorApplicationRepo)` (destructure `operatorApplicationRepo` from `repos`). (c) Mount routes: `.route('/', createOperatorApplicationRoutes(operatorApplicationService, operatorApplicationLimiter))`. (d) Add `operatorApplicationLimiter?: RateLimitBinding` to `AppOverrides`. (e) **Do NOT** add `/operator-applications/*` to the `requireAuth` gate list — it stays public.

- [ ] **Step 5: Add the wrangler binding.** In `packages/api/wrangler.toml` append (dotted keys — do not inline-table them):

```toml
[[ratelimits]]
name = "OPERATOR_APPLICATION_LIMITER"
namespace_id = "1006"
simple.limit = 5
simple.period = 60
```

- [ ] **Step 6: Run, verify pass.** The route test — PASS. `cd packages/api && bun run typecheck` clean.

- [ ] **Step 7: Commit.** `git add packages/api/src/routes/operator-applications.ts packages/api/tests/routes/operator-applications.test.ts packages/api/src/index.ts packages/api/src/app-overrides.ts packages/api/wrangler.toml && git commit -m "feat(#1277): public POST /operator-applications"`

**Slice 1 gate:** `cd packages/api && ../../node_modules/.bin/vitest run` (full api suite green) + `cd packages/shared && bun run typecheck` + `cd packages/api && bun run typecheck`.

---

# SLICE 2 — Public web form

Delivers: `/{locale}/business/register` renders the form, submits to the API, shows a success state; landing CTA links to it. i18n en/ja/zh.

### Task 2.1: Web API client

**Files:** Create `packages/web/src/vite/operator-registration/api.ts` (+ `api.test.ts`)

- [ ] **Step 1: Failing test** (global `fetch` stub, mirror `admin/documents/api.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitOperatorApplication } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

describe('submitOperatorApplication', () => {
  it('POSTs to /api/operator-applications with credentials omitted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: 'a1', status: 'PENDING' } }))
    const r = await submitOperatorApplication({ businessName: 'X' } as never)
    expect(fetchMock).toHaveBeenCalledWith('/api/operator-applications', expect.objectContaining({
      method: 'POST', credentials: 'omit',
    }))
    expect(r).toEqual({ id: 'a1', status: 'PENDING' })
  })
  it('throws ApiError on a 409 envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'dup' }, 409))
    await expect(submitOperatorApplication({} as never)).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2: Run, verify fail.** From `packages/web`: `../../node_modules/.bin/vitest run src/vite/operator-registration/api.test.ts` — FAIL.

- [ ] **Step 3: Implement** (`credentials: 'omit'` per P2a; `unwrap(res, schema)` to satisfy `lint:unwrap-schema`):

```ts
import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { z } from 'zod'

const resultSchema = z.object({ id: z.string(), status: z.literal('PENDING') })
export type OperatorApplicationResult = z.infer<typeof resultSchema>

export async function submitOperatorApplication(
  input: OperatorApplicationInput,
): Promise<OperatorApplicationResult> {
  const res = await fetch(`${getApiBaseUrl()}/operator-applications`, {
    method: 'POST',
    credentials: 'omit', // public endpoint: never send the session cookie (CSRF 403 otherwise)
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return unwrap(res, resultSchema)
}
export { ApiError }
```

- [ ] **Step 4: Run, verify pass.** Same command — PASS.

- [ ] **Step 5: Commit.** `git add packages/web/src/vite/operator-registration/api.ts packages/web/src/vite/operator-registration/api.test.ts && git commit -m "feat(#1277): web operator-registration api client"`

### Task 2.2: i18n keys (en/ja/zh)

**Files:** Modify `packages/web/messages/{en,ja,zh}.json`

- [ ] **Step 1: Add a `business.register` block to en.json** (keys the form/success will consume). Provide real English copy; then translate for ja/zh (parity lint requires identical key sets). Minimum keys:

```json
"register": {
  "title": "List your business on Kuruma",
  "subtitle": "Tell us about your rental business. We review every application.",
  "form": {
    "businessName": "Business name", "contactName": "Contact name",
    "contactEmail": "Email", "contactPhone": "Phone", "serviceArea": "Service area (city/prefecture)",
    "fleetSize": "Estimated fleet size", "website": "Website (optional)",
    "licenseNumber": "Business license number (optional)", "businessType": "Business type (optional)",
    "message": "Anything else? (optional)", "consent": "I agree to be contacted about my application",
    "submit": "Submit application", "submitting": "Submitting...",
    "individual": "Individual", "company": "Company"
  },
  "errors": { "generic": "Couldn't submit your application. Please try again.",
    "duplicate": "An application or account already exists for this email." },
  "success": { "title": "Application received", "body": "Thanks — we'll reach out at {email}." }
}
```

- [ ] **Step 2: Mirror into ja.json and zh.json** (translated values, identical keys). Nest under `business.register` in all three.

- [ ] **Step 3: Verify parity.** From repo root: `bun run lint:i18n-parity` — Expected: PASS (no missing keys).

- [ ] **Step 4: Commit.** `git add packages/web/messages/en.json packages/web/messages/ja.json packages/web/messages/zh.json && git commit -m "feat(#1277): i18n keys for operator registration"`

### Task 2.3: The form component

**Files:** Create `packages/web/src/vite/operator-registration/OperatorRegistrationForm.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Failing component test** (pure render + `IntlProvider`, mirror `DocumentReviewCard.test.tsx`):

```tsx
import { IntlProvider } from 'use-intl'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'
import { OperatorRegistrationForm } from './OperatorRegistrationForm'

const T = enMessages.business.register.form
function renderForm() {
  const onSubmit = vi.fn()
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorRegistrationForm onSubmit={onSubmit} isSubmitting={false} />
    </IntlProvider>,
  )
  return { onSubmit }
}

describe('OperatorRegistrationForm', () => {
  it('submits normalized values when required fields are filled', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'Osaka Rentals' } })
    fireEvent.change(screen.getByLabelText(T.contactName), { target: { value: 'Aiko' } })
    fireEvent.change(screen.getByLabelText(T.contactEmail), { target: { value: 'Aiko@Example.com' } })
    fireEvent.change(screen.getByLabelText(T.contactPhone), { target: { value: '+81 90' } })
    fireEvent.change(screen.getByLabelText(T.serviceArea), { target: { value: 'Osaka' } })
    fireEvent.change(screen.getByLabelText(T.fleetSize), { target: { value: '6-20' } })
    fireEvent.click(screen.getByLabelText(T.consent))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contactEmail: 'aiko@example.com', estimatedFleetSize: '6-20' })
  })
  it('does not submit without consent', async () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText(T.businessName), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await new Promise((r) => setTimeout(r, 20))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, verify fail.** `../../node_modules/.bin/vitest run src/vite/operator-registration/OperatorRegistrationForm.tsx` (test path) — FAIL.

- [ ] **Step 3: Implement** (react-hook-form + `zodResolver(operatorApplicationSchema)`, `submittedLocale` from `useLocale()`, hidden honeypot input, presentational — takes `onSubmit`/`isSubmitting` props; mirror `LocationForm.tsx`). Fields: businessName, contactName, contactEmail, contactPhone, serviceArea, estimatedFleetSize (`<select>` over `OPERATOR_APPLICATION_FLEET_SIZES`), website, businessLicenseNumber, businessType (`<select>`), message (`<textarea>`), consent (`<input type=checkbox>`), honeypot (visually hidden). Wire labels via `useTranslations('business.register.form')`, per-field `errors.<name>?.message`. Set `defaultValues.submittedLocale` from `useLocale()` and `defaultValues.consent = false`.

- [ ] **Step 4: Run, verify pass.** Same command — PASS.

- [ ] **Step 5: Commit.** `git add packages/web/src/vite/operator-registration/OperatorRegistrationForm.tsx packages/web/src/vite/operator-registration/OperatorRegistrationForm.test.tsx && git commit -m "feat(#1277): operator registration form component"`

### Task 2.4: The public route + success state

**Files:**
- Create: `packages/web/src/routes/$locale/business/register.tsx`
- Create: `packages/web/src/vite/operator-registration/RegistrationSuccess.tsx`

- [ ] **Step 1: Implement the route** (public — NO guard `beforeLoad`; `createFileRoute('/$locale/business/register')`). Component holds `useMutation({ mutationFn: submitOperatorApplication })`; on success render `<RegistrationSuccess email={...} />`, else `<OperatorRegistrationForm onSubmit={(v) => mutation.mutate(v)} isSubmitting={mutation.isPending} />` with `mutation.error?.message` surfaced above the form (map `ApiError.status===409` to the `errors.duplicate` copy, else `errors.generic`).

- [ ] **Step 2: Implement `RegistrationSuccess.tsx`** — a presentational panel using `useTranslations('business.register.success')`, `t('body', { email })`.

- [ ] **Step 3: Regenerate the route tree.** Run the web dev/build once so the TanStack Router plugin regenerates `routeTree.gen.ts` (do NOT hand-edit it): from `packages/web`, `bun run build` (or the router codegen script if present). Confirm the new route appears in `routeTree.gen.ts`.

- [ ] **Step 4: Typecheck.** `cd packages/web && bun run typecheck` — clean.

- [ ] **Step 5: Commit.** `git add packages/web/src/routes/$locale/business/register.tsx packages/web/src/vite/operator-registration/RegistrationSuccess.tsx packages/web/src/routeTree.gen.ts && git commit -m "feat(#1277): public /business/register route"`

### Task 2.5: Landing CTA

**Files:** Modify a `packages/web/src/vite/landing/*` component (e.g. the CTA/Footer) + add an `landing.*` i18n key in all three message files.

- [ ] **Step 1:** Add a `<Link to="/$locale/business/register" params={{ locale }}>` CTA ("List your business") in the landing CTA/footer component; add the label key to en/ja/zh under an existing landing block; `bun run lint:i18n-parity` PASS.

- [ ] **Step 2: Commit.** `git commit -am "feat(#1277): landing CTA to operator registration"`

### Task 2.6: E2E (mock track)

**Files:** Create `e2e/operator-registration.spec.ts`

- [ ] **Step 1:** Add a Playwright spec (mock track): visit `/en/business/register`, fill required fields, submit, assert the success panel text is visible. Requires the mock API (`e2e/mock-api.ts`) to handle `POST /operator-applications` → `{ success: true, data: { id, status: 'PENDING' } }`; add that handler.

- [ ] **Step 2: Run.** `bun run test:e2e -- operator-registration` — PASS. Commit.

**Slice 2 gate:** `cd packages/web && bun run typecheck` + web vitest for the new files + `bun run lint:i18n-parity`.

---

# SLICE 3 — Admin review queue (list + reject)

Delivers: admin can list PENDING applications and reject with a reason (audited). Approve is Slice 4.

### Task 3.1: Audit — add the two new kinds (migration + variants)

**Files:**
- Modify: `packages/shared/src/db/audit.ts` (pgEnum), generate migration
- Modify: `packages/api/src/services/audit.ts` (union + `toAuditRow`)
- Create the audit event types (in the service file that raises them, per convention — `services/operator-application.ts`)

- [ ] **Step 1: Extend the pgEnum.** In `packages/shared/src/db/audit.ts` add two values (append last — positional):

```ts
export const auditEventKindEnum = pgEnum('audit_event_kind', [
  'PROVIDER_INVITE_CREATED',
  'OPERATOR_PROFILE_UPDATED',
  'OPERATOR_MEMBER_DEACTIVATED',
  'OPERATOR_APPLICATION_APPROVED',
  'OPERATOR_APPLICATION_REJECTED',
])
```

- [ ] **Step 2: Generate migration.** Repo root `bun run db:generate` → an `ALTER TYPE "audit_event_kind" ADD VALUE ...` (×2) migration. Verify + keep.

- [ ] **Step 3: Define the audit event variants** in `services/operator-application.ts` (mirror `OperatorProfileAuditEvent`):

```ts
export interface OperatorApplicationApprovedAuditEvent {
  readonly type: 'OPERATOR_APPLICATION_APPROVED'
  readonly actorUserId: string
  readonly operatorId: string
  readonly applicationId: string
}
export interface OperatorApplicationRejectedAuditEvent {
  readonly type: 'OPERATOR_APPLICATION_REJECTED'
  readonly actorUserId: string
  readonly applicationId: string
}
```

- [ ] **Step 4: Failing test for `toAuditRow`.** Add cases to the existing audit service test asserting both map correctly (e.g. `toAuditRow({ type:'OPERATOR_APPLICATION_REJECTED', actorUserId:'a', applicationId:'x' })` → `{ kind:'OPERATOR_APPLICATION_REJECTED', actorUserId:'a', operatorId:null, targetId:'x', field:null, oldValue:null, newValue:null }`).

- [ ] **Step 5: Extend the union + `toAuditRow`** in `services/audit.ts`: add the two variants to `AuditEvent`, add two `case` branches (approved → `operatorId` set, `targetId`=applicationId; rejected → `operatorId: null`, `targetId`=applicationId). The exhaustive switch will fail to compile until both are added.

- [ ] **Step 6: Run + typecheck + commit.** Audit service test PASS; `cd packages/api && bun run typecheck` + `cd packages/shared && bun run typecheck` clean. `git add ... && git commit -m "feat(#1277): audit kinds for application approve/reject"`

### Task 3.2: Service — list + reject

**Files:** Modify `packages/api/src/services/operator-application.ts` (+ test)

- [ ] **Step 1: Failing test.** Add to `services/operator-application.test.ts`: `list()` returns newest-first; `reject(id, adminUserId, reason)` flips to REJECTED, stamps reviewer, emits an `OPERATOR_APPLICATION_REJECTED` audit event (inject a `recordAudit` spy); `reject` on a non-PENDING id throws `NotFoundError` (or `ConflictError` — pick `NotFoundError`, matching the "nothing to act on" semantics; assert the message).

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement.** Add a `recordAudit: RecordAuditEvent` constructor arg (default injected in composition). Add:

```ts
async list(status?: OperatorApplicationStatus) { return this.repo.list(status) }

async reject(id: string, reviewerUserId: string, rejectionReason: string): Promise<OperatorApplication> {
  const row = await this.repo.markRejectedIfPending(id, reviewerUserId, new Date(), rejectionReason)
  if (!row) throw new NotFoundError('no pending application with that id')
  this.recordAudit({ type: 'OPERATOR_APPLICATION_REJECTED', actorUserId: reviewerUserId, applicationId: id })
  return row
}
```

- [ ] **Step 4: Run, verify pass; typecheck.** PASS + clean.

- [ ] **Step 5: Commit.** `git commit -am "feat(#1277): application list + reject service"`

### Task 3.3: Admin routes — GET list + POST reject

**Files:**
- Create: `packages/api/src/routes/admin-operator-applications.ts` (or extend `admin.ts`)
- Create: `packages/api/tests/routes/admin-operator-applications.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Failing route test** (bearer PLATFORM_ADMIN via the `bearer()` helper; non-admin → 403). Assert `GET /admin/operator-applications?status=PENDING` returns the seeded rows; `POST /admin/operator-applications/:id/reject` with `{ rejectionReason }` returns the REJECTED row; a non-admin JWT → 403; rejecting a missing id → 404.

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement the routes.** A `createAdminOperatorApplicationRoutes(service)` Hono app: `GET /admin/operator-applications` (parse `?status` against the enum; call `service.list`) and `POST /admin/operator-applications/:id/reject` (`parseBody` a small `z.object({ rejectionReason: z.string().trim().min(1) })`; derive `reviewerUserId` from the auth context like `admin.ts` does; call `service.reject`). Return `ok(c, ...)`. The `/admin/*` app-level `requireAuth()` + `requirePlatformAdmin` gate already applies (mounted at `index.ts:346`); confirm the platform-admin gate is enforced (mirror `admin.ts`).

- [ ] **Step 4: Wire in `index.ts`.** Construct the service with `recordAudit`; mount the admin routes. Reuse the same `operatorApplicationService` instance from Slice 1 (add `list`/`reject`/`approve` to it).

- [ ] **Step 5: Run, verify pass; typecheck; commit.** `git commit -m "feat(#1277): admin list + reject routes"`

### Task 3.4: Admin web module + queue route + sidebar

**Files:**
- Create: `packages/web/src/vite/admin/operator-applications/{api.ts, ApplicationsReviewView.tsx, ApplicationReviewCard.tsx}`
- Create: `packages/web/src/routes/$locale/_admin/admin/operator-applications.tsx`
- Modify: `packages/web/src/vite/nav/AdminSidebar.tsx`, `messages/{en,ja,zh}.json`

- [ ] **Step 1: `api.ts`** — mirror `admin/documents/api.ts`: `fetchOperatorApplications()` → `GET /admin/operator-applications?status=PENDING` (credentials: 'include'), `rejectApplication({id, rejectionReason, csrfToken})` → POST with `X-CSRF-Token` header, `unwrap(res, schema)`. DTO schema over the row (dates as strings). Add a colocated `api.test.ts` (global fetch stub).

- [ ] **Step 2: `ApplicationsReviewView.tsx` + `ApplicationReviewCard.tsx`** — mirror the documents view/card: list rows, each with the business details + a Reject control (reason `<textarea>` → `onReject(id, reason)`). Approve button is added in Slice 4 (leave a placeholder disabled or omit until 4.5). Colocated pure-render test.

- [ ] **Step 3: The route** `operator-applications.tsx` — mirror `documents.tsx`: `loader` prefetch, `useSuspenseQuery`, `useMutation(rejectApplication)`, `csrfToken` from `useSession()`, `errorComponent`.

- [ ] **Step 4: Sidebar + i18n.** Add `{ to: '/$locale/admin/operator-applications', icon: <lucide, e.g. Building2>, labelKey: 'nav.applications' }` to `SIDEBAR_ITEMS`; add `admin.nav.applications` + an `admin.applications.*` block (title/subtitle/empty/reject/reason/error/loadError/retry) to en/ja/zh. `bun run lint:i18n-parity` PASS.

- [ ] **Step 5: Regenerate route tree, typecheck, tests, commit.** `git commit -m "feat(#1277): admin applications queue + reject UI"`

**Slice 3 gate:** api suite green + web typecheck + i18n parity.

---

# SLICE 4 — Approval transaction (the critical path)

Delivers: approve provisions operator + OWNER invite + APPROVED atomically, with the C1 guard and idempotency; returns/surfaces `inviteUrl`; 409 on re-approve.

### Task 4.1: Extract the shared invite-mint helper (M1)

**Files:**
- Create: `packages/api/src/services/invite-mint.ts`
- Modify: `packages/api/src/services/provider-invite.ts` (use it)

- [ ] **Step 1: Failing test.** Create `services/invite-mint.test.ts`: `mintInvite({ webBaseUrl, ttlMs })` returns `{ token, tokenHash, expiresAt, inviteUrl }` where `tokenHash === sha256Hex(token)`, `inviteUrl === \`${base}/provider/invite/${token}\``, and `expiresAt` ≈ now+ttl. (Clock: allow passing `now: Date`.)

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement `invite-mint.ts`** by lifting the token/TTL/hash/URL logic from `provider-invite.ts:83,84,90,115-116`:

```ts
import { randomToken } from '../auth/token' // confirm the exact import used by provider-invite
import { sha256Hex } from '../auth/token-hash'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface MintedInvite { token: string; tokenHash: string; expiresAt: Date; inviteUrl: string }

export function mintInvite(opts: { webBaseUrl: string; ttlMs?: number; now?: Date }): MintedInvite {
  const token = randomToken(32)
  const now = opts.now ?? new Date()
  const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? INVITE_TTL_MS))
  const base = opts.webBaseUrl.replace(/\/$/, '')
  return { token, tokenHash: sha256Hex(token), expiresAt, inviteUrl: `${base}/provider/invite/${token}` }
}
```

- [ ] **Step 4: Refactor `provider-invite.ts`** to call `mintInvite(...)` instead of inlining token/TTL/hash/URL. Keep behaviour identical.

- [ ] **Step 5: Run the FULL provider-invite test suite** (`../../node_modules/.bin/vitest run src/services/provider-invite.test.ts tests/routes/provider-invites.test.ts`) + the new mint test — all PASS (no behaviour drift). Typecheck.

- [ ] **Step 6: Commit.** `git commit -m "refactor(#1277): extract shared invite-mint helper"`

### Task 4.2: Approval tx bundle types + runner + composition

**Files:**
- Modify: `packages/api/src/repositories/types-transactions.ts` (+ re-export in `types.ts`)
- Create: `packages/api/src/repositories/drizzle/operator-approval-transaction.ts`
- Modify: `packages/api/src/composition/repositories.ts` (3 branches)

- [ ] **Step 1: Add the port types** to `types-transactions.ts` (mirror `OperatorGrantRepos`):

```ts
// #1277: atomic operator-approval tx. C1 read guard (email→membership/invite) +
// operator INSERT + invite INSERT + application claim+link, all-or-nothing.
export interface OperatorApprovalRepos {
  users: Pick<UserRepository, 'findByEmail'>
  memberships: Pick<OperatorMembershipRepository, 'findActiveByUserId'>
  invites: Pick<ProviderInviteRepository, 'create' | 'findPendingByEmail'>
  operators: Pick<OperatorRepository, 'create' | 'existsBySlug'>
  applications: Pick<OperatorApplicationRepository, 'markApprovedIfPending'>
}
export type RunOperatorApproval = <T>(fn: (repos: OperatorApprovalRepos) => Promise<T>) => Promise<T>
```

Re-export both from `types.ts` (next to `OperatorGrantRepos`/`RunOperatorGrant`).

- [ ] **Step 2: Add `findPendingByEmail` to `ProviderInviteRepository`** (interface + both impls). In-memory: filter `status==='PENDING' && email.toLowerCase()===target`, return first or undefined. Drizzle: `SELECT ... WHERE email=? AND status='PENDING' LIMIT 1`. Add a quick in-memory test for it.

- [ ] **Step 3: Drizzle runner** — create `operator-approval-transaction.ts` (mirror `operator-grant-transaction.ts`):

```ts
import type { RunTx } from '@kuruma/shared/db'
import type { RunOperatorApproval } from '../types'
import { DrizzleOperatorApplicationRepository } from './operator-application'
import { DrizzleOperatorMembershipRepository } from './operator-membership'
import { DrizzleOperatorRepository } from './operator'
import { DrizzleProviderInviteRepository } from './provider-invite'
import { asTxDb } from './shared'
import { DrizzleUserRepository } from './user'

export function createDrizzleOperatorApproval(runInteractiveTx: RunTx): RunOperatorApproval {
  return async (fn) =>
    runInteractiveTx(async (tx) => {
      const txDb = asTxDb(tx)
      return fn({
        users: new DrizzleUserRepository(txDb),
        memberships: new DrizzleOperatorMembershipRepository(txDb),
        invites: new DrizzleProviderInviteRepository(txDb),
        operators: new DrizzleOperatorRepository(txDb),
        applications: new DrizzleOperatorApplicationRepository(txDb),
      })
    })
}
```

- [ ] **Step 4: Composition wiring.** Add `runOperatorApproval: RunOperatorApproval` to the `Repos` bundle. In-memory + override branches: inline passthrough

```ts
const runOperatorApproval: RunOperatorApproval = (fn) =>
  fn({ users: userRepo, memberships: operatorMembershipRepo, invites: providerInviteRepo, operators: operatorRepo, applications: operatorApplicationRepo })
```

Drizzle branch: `runOperatorApproval: createDrizzleOperatorApproval(tx)` (import it). Return in all three.

- [ ] **Step 5: Typecheck + commit.** `cd packages/api && bun run typecheck` clean. `git commit -m "feat(#1277): operator-approval tx bundle + runner"`

### Task 4.3: Approve service (C1 guard + provisioning + dual audit + idempotency)

**Files:** Modify `packages/api/src/services/operator-application.ts` (+ tests)

- [ ] **Step 1: Failing tests** (the heart of the feature — construct all in-memory repos + the passthrough runner directly; inject `recordAudit` spy + `webBaseUrl`):

```ts
it('approve provisions an operator + OWNER invite and marks APPROVED, returning inviteUrl', async () => {
  const { service, repos, audit } = setupApprove()
  const app = await repos.applications.create(base)
  const r = await service.approve(app.id, 'admin-1')
  expect(r.inviteUrl).toMatch(/\/provider\/invite\//)
  const created = await repos.operators.findBySlug(r.operatorSlug)
  expect(created).toBeTruthy()
  const invites = [...repos.inviteStore.values()]
  expect(invites).toHaveLength(1)
  expect(invites[0]).toMatchObject({ role: 'OPERATOR_OWNER', email: base.contactEmail, invitedByUserId: 'admin-1', acceptedByUserId: null })
  expect(audit.mock.calls.map((c) => c[0].type)).toEqual(
    expect.arrayContaining(['PROVIDER_INVITE_CREATED', 'OPERATOR_APPLICATION_APPROVED']))
  const reloaded = await repos.applications.findById(app.id)
  expect(reloaded).toMatchObject({ status: 'APPROVED', operatorId: created!.id })
})

it('double-approve creates exactly one operator + one invite (idempotent)', async () => {
  const { service, repos } = setupApprove()
  const app = await repos.applications.create(base)
  await service.approve(app.id, 'admin-1')
  await expect(service.approve(app.id, 'admin-1')).rejects.toThrow('already reviewed')
  expect([...repos.inviteStore.values()]).toHaveLength(1)
  expect(await repos.operators.list()).toHaveLength(1)
})

it('C1: rejects approval when the email already has an active membership', async () => {
  const { service, repos } = setupApprove()
  // seed a user with an active membership at another operator
  const app = await repos.applications.create(base)
  seedActiveMembershipFor(repos, base.contactEmail)
  await expect(service.approve(app.id, 'admin-1')).rejects.toThrow('already has')
  expect(await repos.operators.list()).toHaveLength(1) // only the pre-seeded one; no orphan B
})

it('C1: rejects approval when a live pending invite exists for the email', async () => {
  const { service, repos } = setupApprove()
  const app = await repos.applications.create(base)
  await repos.invites.create({ email: base.contactEmail, operatorId: 'op-A', role: 'OPERATOR_STAFF', tokenHash: 'h', status: 'PENDING', expiresAt: new Date(Date.now()+1e6), invitedByUserId: null, acceptedByUserId: null })
  await expect(service.approve(app.id, 'admin-1')).rejects.toThrow('invited')
})
```

- [ ] **Step 2: Run, verify fail.** FAIL.

- [ ] **Step 3: Implement `approve`.** Add constructor deps: `runOperatorApproval: RunOperatorApproval`, `webBaseUrl: string` (from config), and reuse `recordAudit`. Implementation:

```ts
async approve(id: string, reviewerUserId: string): Promise<{ operatorId: string; operatorSlug: string; inviteUrl: string; expiresAt: Date }> {
  const minted = mintInvite({ webBaseUrl: this.webBaseUrl })
  // audit events collected inside the tx, emitted only after commit
  const events: AuditEvent[] = []
  const result = await this.runApproval(async (repos) => {
    // C1 cross-aggregate guard — the applications index cannot see these paths.
    const existingUser = await repos.users.findByEmail(/* need the app's email */)
    // (load the application first — see note)
    // ... guard: active membership OR live pending invite → ConflictError
    // ... derive slug via resolveUniqueSlug(slugify(businessName), repos.operators.existsBySlug)
    // ... operators.create({ name, slug, preAuthHandoffUrl: null })
    // ... invites.create({ email, operatorId, role:'OPERATOR_OWNER', tokenHash: minted.tokenHash, status:'PENDING', expiresAt: minted.expiresAt, invitedByUserId: reviewerUserId, acceptedByUserId: null })
    // ... const claimed = await applications.markApprovedIfPending(id, operatorId, reviewerUserId, new Date()); if (!claimed) throw new ConflictError('application already reviewed')
    // ... push both audit events into `events`
    // return { operatorId, operatorSlug: slug }
  })
  events.forEach((e) => this.recordAudit(e))
  return { ...result, inviteUrl: minted.inviteUrl, expiresAt: minted.expiresAt }
}
```

Implementation notes to resolve in code:
  - **Load the application** to get `contactEmail`/`businessName`. Add `findById` to the tx bundle's `applications` port (widen `Pick<...>`), or read it via the root repo BEFORE the tx (acceptable — email/name are immutable once PENDING) and pass into the closure. Prefer reading before the tx to keep the bundle lean; re-checked idempotency inside via `markApprovedIfPending`.
  - **C1 guard order:** inside the tx, before creating anything: `const u = await repos.users.findByEmail(email); if (u && await repos.memberships.findActiveByUserId(u.id)) throw new ConflictError('this email already has an operator'); if (await repos.invites.findPendingByEmail(email)) throw new ConflictError('this email is already invited to an operator')`.
  - **Slug:** `const slug = await resolveUniqueSlug(slugify(businessName), (s) => repos.operators.existsBySlug(s))` (import from `./slug`).
  - **Idempotency:** the throw on `!claimed` rolls back the whole tx (operator + invite), so a second approve creates nothing.
  - **Audit collection:** push `{ type:'PROVIDER_INVITE_CREATED', invitedByUserId: reviewerUserId, operatorId, email }` and `{ type:'OPERATOR_APPLICATION_APPROVED', actorUserId: reviewerUserId, operatorId, applicationId: id }`; emit AFTER commit (matches the fire-and-forget audit convention).

- [ ] **Step 4: Run, verify pass.** All approve tests PASS. Typecheck clean.

- [ ] **Step 5: Commit.** `git commit -m "feat(#1277): approve service — C1 guard + atomic provisioning"`

### Task 4.4: Approve route + 409 semantics + admin UI approve

**Files:**
- Modify: `packages/api/src/routes/admin-operator-applications.ts` (+ test), `packages/api/src/index.ts`
- Modify: `packages/web/src/vite/admin/operator-applications/*` + route

- [ ] **Step 1: Failing route test.** `POST /admin/operator-applications/:id/approve` (PLATFORM_ADMIN) → 200 `{ data: { operatorId, inviteUrl, expiresAt } }`; a SECOND approve of the same id → **409** (`ConflictError` "already reviewed"); non-admin → 403; C1 conflict (seed a colliding membership) → 409.

- [ ] **Step 2: Implement the route** — call `service.approve(id, reviewerUserId)`, `ok(c, result)`. `ConflictError` from the service maps to 409 via the global handler automatically. No token reconstruction on re-approve — the 409 body carries no link.

- [ ] **Step 3: Wire the service deps in `index.ts`** — pass `runOperatorApproval` (from `repos`), `webBaseUrl` (reuse the same config `provider-invite` uses), and `recordAudit` into the `OperatorApplicationService` constructor.

- [ ] **Step 4: Admin UI approve.** Add `approveApplication({id, csrfToken})` to `admin/operator-applications/api.ts`; add an Approve button to `ApplicationReviewCard`; on success show the returned `inviteUrl` as a copyable link (a small read-only input + copy button). Surface a 409 as an inline "already reviewed / already an operator" message. Colocated tests.

- [ ] **Step 5: Run all, typecheck, regenerate route tree, commit.** `git commit -m "feat(#1277): approve route + admin approve UI with invite link"`

**Slice 4 gate:** FULL api suite green + web typecheck + i18n parity + both package typechecks.

---

# SLICE 5 — Emails (fast-follow, optional)

Only if a reusable send seam lands. Today there is **no** send-invite-email seam (`ProviderInviteService` takes no `EmailSender`), so this slice is explicitly deferred. When built:
- Submit → confirmation email to applicant + admin alert.
- Approve → email the `inviteUrl` to the applicant.
- Reject → email `rejectionReason`.
Each behind the existing `EmailSender` seam (`index.ts:587`), injected into `OperatorApplicationService`; tests assert the sender is called with the right payload. Do not build until the seam is confirmed reusable.

---

## Final verification (before PR)

- [ ] From `packages/api`: `../../node_modules/.bin/vitest run` — full suite green.
- [ ] From `packages/web`: `../../node_modules/.bin/vitest run` — green.
- [ ] `cd packages/shared && bun run typecheck`; `cd packages/api && bun run typecheck`; `cd packages/web && bun run typecheck` — all clean.
- [ ] Repo root: `bun run lint:i18n-parity`, `bun run lint:unwrap-schema`, `bun run lint:size`, `bun run lint:fk-indexes` — all pass.
- [ ] `bun run test:e2e -- operator-registration` — green (mock track).
- [ ] Migrations committed under `drizzle/`; the drizzle SQL path is validated by CI neon-tx (real DB) — not locally.
- [ ] code-reviewer + architect-review pass on the diff.
- [ ] PR `Closes #1277`, base `develop`.

## Self-review notes (author)

- **Spec coverage:** every v4 section maps to a task — data model (1.2), enums SSoT (1.1), validator (1.3), repo pair (1.5/1.6), dedup index + named-constraint 409 (1.2/1.7/1.8/1.9), public form + credentials:'omit' (2.1-2.4), admin queue (3.x), approval tx + C1 + OWNER + full invite payload + dual audit + idempotency + 409 (4.x), audit migration (3.1), rate-limiter parity (1.9), shared invite-mint M1 (4.1).
- **Open item for the executor:** confirm the exact `randomToken` import path and `ok()` status-arg signature in Task 1.9/4.1 (referenced from `provider-invite.ts`/`admin.ts`) before writing those blocks.
