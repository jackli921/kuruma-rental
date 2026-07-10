# Operator Usage-Consent (Rental Terms) — Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator author, publish, and archive their own multi-locale rental-terms document, shipped dark behind `VITE_FEATURE_OPERATOR_TERMS`. No renter effect yet (that is Slice B).

**Architecture:** A thin, additive extension of the #877 consent ledger. `consent_documents` gains a nullable `operatorId` (platform docs stay NULL). An operator's "rental terms" is a **version group**: the set of `consent_documents` rows sharing `(operatorId, type='OPERATOR_RENTAL_TERMS', version)`, one row per locale (`en` required, `ja`/`zh` optional). A new `OperatorTermsService` owns the `DRAFT → PUBLISHED → ARCHIVED` state machine; `consent_documents` is INSERTed at runtime for the first time, so a DB trigger enforces PUBLISHED-row immutability. Authoring mirrors the insurance slice-3a authz/routing pattern (`assertFleetWriteWithinOperator` + `fleetWriteDenialResult` + `?operatorId=` picker binding). The web operator surface mirrors `operator-insurance`, gated by a route `beforeLoad` flag check.

**Tech Stack:** Drizzle (Postgres) + Hono (CF Workers) API, Vite + TanStack Router + shadcn web, Zod validators in `@kuruma/shared`, Vitest (unit + real-pg integration), use-intl i18n.

**Reference spec:** `docs/superpowers/specs/2026-07-07-operator-usage-consent-design.md` (v1.1, owner-locked).

---

## Design decisions locked for this slice

1. **Version group model.** A logical terms doc = rows sharing `(operatorId, type, version)`. `version` is assigned at create as `v${N}` where `N = maxExistingVersionNumber + 1` per `(operatorId, type)`.
2. **One DRAFT at a time** per `(operatorId, type)`. `saveDraft` upserts the single draft version (creates `v${N}` if none, else replaces the existing DRAFT version's rows). This makes create + edit one operation and dodges per-locale upsert bookkeeping (a DRAFT row has no acceptances — FK-safe to delete/replace).
3. **Publish** flips every row of a version `DRAFT → PUBLISHED`, stamps `publishedAt`, recomputes `contentHash`.
4. **Archive** flips every row of a version `PUBLISHED → ARCHIVED`.
5. **Immutability** enforced in the service AND a DB trigger (owner-locked). Trigger raises `check_violation` (23514) on content mutation of a PUBLISHED row; allows only `PUBLISHED → ARCHIVED` and `updatedAt`.
6. **Feature flag** `OPERATOR_TERMS` is a build-time web flag (`VITE_FEATURE_OPERATOR_TERMS`), NOT `serverOnly` — it gates only the web surface (the API stays reachable so Slice B tests can exercise it; a dark authoring API with no linked UI is harmless).

## File Structure

**Shared (`packages/shared/src`):**
- `enums.ts` — MODIFY: add `OPERATOR_RENTAL_TERMS` to `CONSENT_TYPES` + `CONSENT_CARDINALITY`.
- `db/consent.ts` — MODIFY: add `operatorId` column + FK-cover index; swap doc uniqueness to two partial uniques.
- `validators/consent-documents.ts` — CREATE: Zod schemas for the authoring input (operator + admin variants).
- `feature-flags/registry.ts` — MODIFY: add `OPERATOR_TERMS` entry.

**API (`packages/api/src`):**
- `stores.ts` — MODIFY: add `operatorId` to the `ConsentDocument` entity.
- `repositories/types-consent.ts` — MODIFY: add `NewConsentDocument` input + operator resolution/authoring method signatures.
- `repositories/drizzle/consent.ts` — MODIFY: map `operatorId`; implement the new methods.
- `repositories/in-memory/consent.ts` — MODIFY: implement the new methods.
- `services/operator-terms.ts` — CREATE: `OperatorTermsService` (state machine + authz).
- `routes/operator-terms.ts` — CREATE: authoring router.
- `index.ts` — MODIFY: construct + wire the service and router.

**Migrations (`drizzle/`):** `0103` (enum), `0104` (column + uniques), `0105` (trigger, custom).

**Web (`packages/web/src`):**
- `vite/operator-terms/` — CREATE: `api.ts`, `TermsForm.tsx`, `OperatorTermsView.tsx`, dialogs, `index.ts`.
- `routes/$locale/_business/manage/terms.tsx` — CREATE: route + flag `beforeLoad`.
- `vite/operator-context/operator-context.ts` — MODIFY: add the route id to `OPERATOR_CONTEXT_ROUTE_IDS`.
- `vite/nav/` operator sidebar — MODIFY: flag-gated nav link.
- `vite/config/feature-flags-runtime.ts` + `vite/vite-env.d.ts` — MODIFY: build-time reader + env type.
- `messages/{en,ja,zh}.json` — MODIFY: `business.terms.*`.

---

## Task 1: Enum + cardinality + enum migration

**Files:**
- Modify: `packages/shared/src/enums.ts:204-225`
- Test: `packages/shared/src/enums.test.ts` (create if absent)
- Migration: `drizzle/0103_*` (generated)

- [ ] **Step 1: Write the failing test**

Create/append `packages/shared/src/enums.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CONSENT_CARDINALITY, CONSENT_TYPES } from './enums'

describe('OPERATOR_RENTAL_TERMS consent type', () => {
  it('is a registered consent type', () => {
    expect(CONSENT_TYPES).toContain('OPERATOR_RENTAL_TERMS')
  })
  it('is per-event (accepted on every booking, like liability)', () => {
    expect(CONSENT_CARDINALITY.OPERATOR_RENTAL_TERMS).toBe('PER_EVENT')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun run --filter @kuruma/shared test enums`
Expected: FAIL — `CONSENT_TYPES` does not contain the value; `CONSENT_CARDINALITY.OPERATOR_RENTAL_TERMS` is `undefined`.

- [ ] **Step 3: Add the enum value + cardinality**

In `packages/shared/src/enums.ts`, edit `CONSENT_TYPES` and `CONSENT_CARDINALITY`:

```typescript
export const CONSENT_TYPES = [
  'RENTER_TOS',
  'PRIVACY_POLICY',
  'RENTER_LIABILITY',
  'OPERATOR_AGREEMENT',
  'OPERATOR_RENTAL_TERMS',
] as const
```

```typescript
export const CONSENT_CARDINALITY: Record<ConsentType, ConsentCardinality> = {
  RENTER_TOS: 'ONCE_PER_SUBJECT',
  PRIVACY_POLICY: 'ONCE_PER_SUBJECT',
  OPERATOR_AGREEMENT: 'ONCE_PER_SUBJECT',
  RENTER_LIABILITY: 'PER_EVENT',
  OPERATOR_RENTAL_TERMS: 'PER_EVENT',
}
```

(The `Record<ConsentType, ...>` type forces the cardinality entry to compile.)

- [ ] **Step 4: Run test, verify it passes**

Run: `bun run --filter @kuruma/shared test enums`
Expected: PASS.

- [ ] **Step 5: Generate the enum-only migration**

CRITICAL (#27 rule): the enum `ADD VALUE` must be its OWN migration, ahead of any statement that references the literal. `consent.ts` is unchanged at this point, so generation yields only the `ALTER TYPE`.

Run: `bun run db:generate --name add_operator_rental_terms_enum`
Then open the new `drizzle/0103_add_operator_rental_terms_enum.sql` and confirm it contains ONLY:

```sql
ALTER TYPE "public"."consent_type" ADD VALUE 'OPERATOR_RENTAL_TERMS';
```

If it contains anything else, STOP — the schema was edited too early.

- [ ] **Step 6: Migrate + verify**

Run: `bun run db:migrate && bun run db:verify`
Expected: migrate succeeds; `db:verify` shows 3 green checks.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/enums.test.ts drizzle/0103_add_operator_rental_terms_enum.sql drizzle/meta
git commit -m "feat(consent): add OPERATOR_RENTAL_TERMS enum + PER_EVENT cardinality"
```

---

## Task 2: `consent_documents.operatorId` + two partial uniques

**Files:**
- Modify: `packages/shared/src/db/consent.ts:25-48`
- Modify: `packages/api/src/stores.ts:616-630` (ConsentDocument entity)
- Modify: `packages/api/src/repositories/drizzle/consent.ts:20-36` (toDocument mapper)
- Migration: `drizzle/0104_*` (generated)
- Test: `packages/api/tests/integration/consent-operator-docs.test.ts` (create)

- [ ] **Step 1: Write the failing real-pg test**

Create `packages/api/tests/integration/consent-operator-docs.test.ts`. It proves the two partial uniques: platform (`operatorId NULL`) dedup is preserved, and two operators may each hold the same `(type,version,locale)`.

```typescript
import { consentDocuments } from '@kuruma/shared/db/schema'
import { eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import { BEST_CAR_RENTAL_OPERATOR_ID } from './booking-factory'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema: { consentDocuments } })

const createdIds: string[] = []
function doc(over: Partial<typeof consentDocuments.$inferInsert>): typeof consentDocuments.$inferInsert {
  const id = crypto.randomUUID()
  createdIds.push(id)
  return {
    id, type: 'OPERATOR_RENTAL_TERMS', version: 'v1', locale: 'en',
    title: 'Terms', body: 'Body', acceptanceLabel: 'I agree', contentHash: 'h',
    status: 'DRAFT', effectiveFrom: new Date('2026-01-01T00:00:00Z'), ...over,
  }
}
async function insert(v: typeof consentDocuments.$inferInsert): Promise<unknown> {
  try { await db.insert(consentDocuments).values(v); return null } catch (e) { return e }
}

afterAll(async () => {
  if (createdIds.length) await db.delete(consentDocuments).where(inArray(consentDocuments.id, createdIds))
  await client.end()
})

describe('consent_documents partial uniques (§4.3)', () => {
  it('rejects a second platform doc with the same (type,version,locale)', async () => {
    expect(await insert(doc({ type: 'RENTER_TOS', version: 'vдубль', operatorId: null }))).toBeNull()
    const err = await insert(doc({ type: 'RENTER_TOS', version: 'vдубль', operatorId: null }))
    expect(pgErrorCode(err)).toBe('23505')
    expect(pgConstraintName(err)).toBe('consent_documents_platform_tvl_unique')
  })

  it('lets two different operators each hold the same (type,version,locale)', async () => {
    const secondOp = crypto.randomUUID() // relies on an existing operator; see note
    expect(await insert(doc({ operatorId: BEST_CAR_RENTAL_OPERATOR_ID, version: 'v-op-a' }))).toBeNull()
    // same operator, same tuple → rejected
    const dupe = await insert(doc({ operatorId: BEST_CAR_RENTAL_OPERATOR_ID, version: 'v-op-a' }))
    expect(pgErrorCode(dupe)).toBe('23505')
    expect(pgConstraintName(dupe)).toBe('consent_documents_operator_tvl_unique')
  })
})
```

Note: the second-operator positive case needs a real second operator row; if only `BEST_CAR_RENTAL_OPERATOR_ID` is seeded, assert only the same-operator rejection + the platform rejection (both prove the two indexes are distinct predicates). Keep the seeded-operator FK valid — do not invent a random `operatorId` that violates the FK.

- [ ] **Step 2: Run it, verify it fails**

Run (with a throwaway pg on `DATABASE_URL`): `bun run --filter @kuruma/api test:integration consent-operator-docs`
Expected: FAIL — column `operatorId` does not exist / constraint names not found.

- [ ] **Step 3: Add the column + swap uniqueness in the schema**

In `packages/shared/src/db/consent.ts`, add `operators` is already imported. Add the column to `consentDocuments` and replace the constraint block:

```typescript
export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: text('id').primaryKey(),
    type: consentTypeEnum('type').notNull(),
    version: text('version').notNull(),
    locale: text('locale').notNull(),
    // Platform docs stay NULL; operator-authored rental-terms set it (§4.2).
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    acceptanceLabel: text('acceptanceLabel').notNull(),
    contentHash: text('contentHash').notNull(),
    status: consentDocStatusEnum('status').notNull().default('DRAFT'),
    effectiveFrom: timestamp('effectiveFrom', { withTimezone: true }).notNull(),
    publishedAt: timestamp('publishedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §4.3 — two partial uniques (Postgres treats NULLs as distinct, so a single
    // nullable-column unique would let duplicate platform rows in).
    uniqueIndex('consent_documents_platform_tvl_unique')
      .on(t.type, t.version, t.locale)
      .where(sql`${t.operatorId} IS NULL`),
    uniqueIndex('consent_documents_operator_tvl_unique')
      .on(t.operatorId, t.type, t.version, t.locale)
      .where(sql`${t.operatorId} IS NOT NULL`),
    // Composite-FK target for acceptances' sync seal — unchanged.
    unique('consent_documents_id_type_unique').on(t.id, t.type),
    // FK-covering index (lint:fk-indexes).
    index('consent_documents_operator_idx').on(t.operatorId),
  ],
)
```

- [ ] **Step 4: Add `operatorId` to the entity + drizzle mapper**

In `packages/api/src/stores.ts`, add to the `ConsentDocument` interface after `locale`:

```typescript
  operatorId: string | null
```

In `packages/api/src/repositories/drizzle/consent.ts`, add to `toDocument` after `locale: r.locale,`:

```typescript
    operatorId: r.operatorId,
```

- [ ] **Step 5: Generate migration**

Run: `bun run db:generate --name consent_documents_operator_id`
Open `drizzle/0104_consent_documents_operator_id.sql`. Confirm it: adds the `operatorId` column + FK, DROPs `consent_documents_type_version_locale_unique`, CREATEs the two partial unique indexes + the fk-cover index. It must NOT reference `'OPERATOR_RENTAL_TERMS'` (no enum literal here).

- [ ] **Step 6: Migrate + verify + run the test**

Run: `bun run db:migrate && bun run db:verify`
Then: `bun run --filter @kuruma/api test:integration consent-operator-docs`
Expected: verify green; test PASSES.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/db/consent.ts packages/api/src/stores.ts packages/api/src/repositories/drizzle/consent.ts packages/api/tests/integration/consent-operator-docs.test.ts drizzle/0104_consent_documents_operator_id.sql drizzle/meta
git commit -m "feat(consent): consent_documents.operatorId + two partial uniques"
```

---

## Task 3: PUBLISHED-row immutability trigger (custom migration)

**Files:**
- Migration: `drizzle/0105_*` (custom)
- Test: append to `packages/api/tests/integration/consent-operator-docs.test.ts`

- [ ] **Step 1: Write the failing real-pg test**

Append a describe block to `consent-operator-docs.test.ts`:

```typescript
describe('consent_documents PUBLISHED immutability trigger (§5.1)', () => {
  it('rejects content mutation of a PUBLISHED row but allows PUBLISHED→ARCHIVED', async () => {
    const id = crypto.randomUUID(); createdIds.push(id)
    await db.insert(consentDocuments).values(doc({ id, status: 'PUBLISHED', version: 'v-imm', operatorId: BEST_CAR_RENTAL_OPERATOR_ID }))

    let err: unknown = null
    try { await db.update(consentDocuments).set({ body: 'tampered' }).where(eq(consentDocuments.id, id)) } catch (e) { err = e }
    expect(pgErrorCode(err)).toBe('23514')

    // status-only transition to ARCHIVED is allowed
    await db.update(consentDocuments).set({ status: 'ARCHIVED' }).where(eq(consentDocuments.id, id))
    const [row] = await db.select().from(consentDocuments).where(eq(consentDocuments.id, id))
    expect(row?.status).toBe('ARCHIVED')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `bun run --filter @kuruma/api test:integration consent-operator-docs`
Expected: FAIL — the UPDATE of `body` succeeds (no trigger yet), so `pgErrorCode(err)` is `undefined`, not `'23514'`.

- [ ] **Step 3: Write the custom trigger migration**

Run: `bun run db:generate --custom --name consent_published_immutable`
Fill `drizzle/0105_consent_published_immutable.sql` (trigger is snapshot-invisible — no drift):

```sql
-- §5.1: consent_documents is INSERTed at runtime for the first time (operator
-- authoring). A PUBLISHED legal document is immutable; new wording is a new
-- version row. This trigger is the DB seal (service also refuses). Snapshot-
-- invisible (triggers are not expressible in drizzle's table builder), so it
-- causes no schema-vs-snapshot drift.
CREATE OR REPLACE FUNCTION consent_documents_block_published_update() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.title <> OLD.title
       OR NEW.body <> OLD.body
       OR NEW."acceptanceLabel" <> OLD."acceptanceLabel"
       OR NEW."contentHash" <> OLD."contentHash"
       OR NEW.type <> OLD.type
       OR NEW.version <> OLD.version
       OR NEW.locale <> OLD.locale
       OR NEW."effectiveFrom" <> OLD."effectiveFrom"
       OR NEW."operatorId" IS DISTINCT FROM OLD."operatorId"
    THEN
      RAISE EXCEPTION 'consent_documents: PUBLISHED rows are immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'consent_documents: PUBLISHED may only transition to ARCHIVED (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_documents_immutable_published
  BEFORE UPDATE ON consent_documents
  FOR EACH ROW EXECUTE FUNCTION consent_documents_block_published_update();
```

- [ ] **Step 4: Migrate + verify + run the test**

Run: `bun run db:migrate && bun run db:verify`
Then: `bun run --filter @kuruma/api test:integration consent-operator-docs`
Expected: verify green (trigger is snapshot-invisible); test PASSES.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0105_consent_published_immutable.sql drizzle/meta packages/api/tests/integration/consent-operator-docs.test.ts
git commit -m "feat(consent): DB trigger enforcing PUBLISHED-row immutability"
```

---

## Task 4: Repository — operator-doc resolution + authoring methods

**Files:**
- Modify: `packages/api/src/repositories/types-consent.ts` (interface + `NewConsentDocument`)
- Modify: `packages/api/src/repositories/drizzle/consent.ts`
- Modify: `packages/api/src/repositories/in-memory/consent.ts`
- Test: `packages/api/tests/integration/consent-operator-repo.test.ts` (create, real-pg)

**Fix-up first:** adding `operatorId` to the `ConsentDocument` entity (Task 2) makes every `ConsentDocument` literal in tests fail tsc. Run `bunx tsc -p packages/api --noEmit` and add `operatorId: null` to each flagged `doc(...)`/`ConsentDocument` factory (grep: `rg "type: 'RENTER_TOS'|acceptanceLabel:" packages/api --files-with-matches`). Commit these mechanical fixups with Task 2 if not already green.

- [ ] **Step 1: Add the input type + interface methods**

In `packages/api/src/repositories/types-consent.ts`, add near the other input types:

```typescript
export interface NewConsentDocument {
  operatorId: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
  status: ConsentDocStatus
  effectiveFrom: Date
  publishedAt: Date | null
}
```

Add to the `ConsentRepository` interface (import `ConsentDocStatus` from `@kuruma/shared/enums` if not present):

```typescript
  // --- Operator-authored rental-terms (§5.3 resolution + authoring) ---
  findLatestPublishedVersionForOperator(
    operatorId: string,
    type: ConsentType,
    now: Date,
  ): Promise<string | undefined>
  findPublishedOperatorDocument(
    operatorId: string,
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined>
  /** Every row this operator authored for a type (any status) — the service groups by version. */
  findOperatorDocuments(operatorId: string, type: ConsentType): Promise<ConsentDocument[]>
  createOperatorDocuments(rows: NewConsentDocument[]): Promise<ConsentDocument[]>
  deleteOperatorDraftRows(operatorId: string, type: ConsentType, version: string): Promise<void>
  setOperatorVersionStatus(params: {
    operatorId: string
    type: ConsentType
    version: string
    from: ConsentDocStatus
    to: ConsentDocStatus
    publishedAt: Date | null
    now: Date
  }): Promise<ConsentDocument[]>
```

- [ ] **Step 2: Write the failing real-pg repo test**

Create `packages/api/tests/integration/consent-operator-repo.test.ts`:

```typescript
import { consentDocuments } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleConsentRepository } from '../../src/repositories/drizzle/consent'
import type { Db } from '../../src/repositories/drizzle/shared'
import type { NewConsentDocument } from '../../src/repositories/types-consent'
import { BEST_CAR_RENTAL_OPERATOR_ID } from './booking-factory'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema: { consentDocuments } }) as unknown as Db
const repo = new DrizzleConsentRepository(db)
const OP = BEST_CAR_RENTAL_OPERATOR_ID

function row(over: Partial<NewConsentDocument>): NewConsentDocument {
  return {
    operatorId: OP, type: 'OPERATOR_RENTAL_TERMS', version: 'v1', locale: 'en',
    title: 'T', body: 'B', acceptanceLabel: 'I agree', contentHash: 'h',
    status: 'DRAFT', effectiveFrom: new Date('2026-01-01T00:00:00Z'), publishedAt: null, ...over,
  }
}
beforeEach(async () => { await db.delete(consentDocuments).where(eq(consentDocuments.operatorId, OP)) })
afterAll(async () => {
  await db.delete(consentDocuments).where(eq(consentDocuments.operatorId, OP)); await client.end()
})

describe('DrizzleConsentRepository operator authoring', () => {
  it('creates rows and lists them by operator+type', async () => {
    await repo.createOperatorDocuments([row({}), row({ locale: 'ja' })])
    const all = await repo.findOperatorDocuments(OP, 'OPERATOR_RENTAL_TERMS')
    expect(all.map((d) => d.locale).sort()).toEqual(['en', 'ja'])
    expect(all.every((d) => d.operatorId === OP)).toBe(true)
  })

  it('flips a version DRAFT→PUBLISHED and resolves the latest published version', async () => {
    await repo.createOperatorDocuments([row({ version: 'v1' })])
    const now = new Date('2026-06-01T00:00:00Z')
    const published = await repo.setOperatorVersionStatus({
      operatorId: OP, type: 'OPERATOR_RENTAL_TERMS', version: 'v1',
      from: 'DRAFT', to: 'PUBLISHED', publishedAt: now, now,
    })
    expect(published).toHaveLength(1)
    expect(published[0]?.status).toBe('PUBLISHED')
    expect(await repo.findLatestPublishedVersionForOperator(OP, 'OPERATOR_RENTAL_TERMS', now)).toBe('v1')
    const doc = await repo.findPublishedOperatorDocument(OP, 'OPERATOR_RENTAL_TERMS', 'v1', 'en')
    expect(doc?.title).toBe('T')
  })

  it('deletes only DRAFT rows of a version', async () => {
    await repo.createOperatorDocuments([row({ version: 'v2', status: 'DRAFT' })])
    await repo.deleteOperatorDraftRows(OP, 'OPERATOR_RENTAL_TERMS', 'v2')
    expect(await repo.findOperatorDocuments(OP, 'OPERATOR_RENTAL_TERMS')).toHaveLength(0)
  })
})
```

Run: `bun run --filter @kuruma/api test:integration consent-operator-repo` → FAIL (methods undefined).

- [ ] **Step 3: Implement in the Drizzle repo**

In `packages/api/src/repositories/drizzle/consent.ts` add these methods to `DrizzleConsentRepository` (imports `and`, `eq` already present):

```typescript
async findLatestPublishedVersionForOperator(
  operatorId: string, type: ConsentType, now: Date,
): Promise<string | undefined> {
  const rows = await this.db
    .select({ version: consentDocuments.version, effectiveFrom: consentDocuments.effectiveFrom })
    .from(consentDocuments)
    .where(and(
      eq(consentDocuments.operatorId, operatorId),
      eq(consentDocuments.type, type),
      eq(consentDocuments.status, 'PUBLISHED'),
    ))
  return rows
    .filter((r) => r.effectiveFrom <= now)
    .map((r) => r.version)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)
}

async findPublishedOperatorDocument(
  operatorId: string, type: ConsentType, version: string, locale: string,
): Promise<ConsentDocument | undefined> {
  const [row] = await this.db.select().from(consentDocuments).where(and(
    eq(consentDocuments.operatorId, operatorId),
    eq(consentDocuments.type, type),
    eq(consentDocuments.version, version),
    eq(consentDocuments.locale, locale),
    eq(consentDocuments.status, 'PUBLISHED'),
  )).limit(1)
  return row ? toDocument(row) : undefined
}

async findOperatorDocuments(operatorId: string, type: ConsentType): Promise<ConsentDocument[]> {
  const rows = await this.db.select().from(consentDocuments).where(and(
    eq(consentDocuments.operatorId, operatorId),
    eq(consentDocuments.type, type),
  ))
  return rows.map(toDocument)
}

async createOperatorDocuments(rows: NewConsentDocument[]): Promise<ConsentDocument[]> {
  if (rows.length === 0) return []
  const inserted = await this.db.insert(consentDocuments)
    .values(rows.map((r) => ({ ...r, id: crypto.randomUUID() })))
    .returning()
  return inserted.map(toDocument)
}

async deleteOperatorDraftRows(operatorId: string, type: ConsentType, version: string): Promise<void> {
  await this.db.delete(consentDocuments).where(and(
    eq(consentDocuments.operatorId, operatorId),
    eq(consentDocuments.type, type),
    eq(consentDocuments.version, version),
    eq(consentDocuments.status, 'DRAFT'),
  ))
}

async setOperatorVersionStatus(p: {
  operatorId: string; type: ConsentType; version: string
  from: ConsentDocStatus; to: ConsentDocStatus; publishedAt: Date | null; now: Date
}): Promise<ConsentDocument[]> {
  const set: Partial<typeof consentDocuments.$inferInsert> = { status: p.to, updatedAt: p.now }
  if (p.publishedAt) set.publishedAt = p.publishedAt
  const rows = await this.db.update(consentDocuments).set(set).where(and(
    eq(consentDocuments.operatorId, p.operatorId),
    eq(consentDocuments.type, p.type),
    eq(consentDocuments.version, p.version),
    eq(consentDocuments.status, p.from),
  )).returning()
  return rows.map(toDocument)
}
```

Add `ConsentDocStatus` + `NewConsentDocument` to the imports at the top of the file.

- [ ] **Step 4: Implement in the in-memory repo**

In `packages/api/src/repositories/in-memory/consent.ts`, add mutation-based twins (the store is `this.docs: Map<string, ConsentDocument>`):

```typescript
async findLatestPublishedVersionForOperator(operatorId, type, now): Promise<string | undefined> {
  return [...this.docs.values()]
    .filter((d) => d.operatorId === operatorId && d.type === type && d.status === 'PUBLISHED' && d.effectiveFrom <= now)
    .map((d) => d.version)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)
}
async findPublishedOperatorDocument(operatorId, type, version, locale): Promise<ConsentDocument | undefined> {
  return [...this.docs.values()].find((d) =>
    d.operatorId === operatorId && d.type === type && d.version === version &&
    d.locale === locale && d.status === 'PUBLISHED')
}
async findOperatorDocuments(operatorId, type): Promise<ConsentDocument[]> {
  return [...this.docs.values()].filter((d) => d.operatorId === operatorId && d.type === type)
}
async createOperatorDocuments(rows: NewConsentDocument[]): Promise<ConsentDocument[]> {
  const created = rows.map((r) => ({ ...r, id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() }))
  for (const d of created) this.docs.set(d.id, d)
  return created
}
async deleteOperatorDraftRows(operatorId, type, version): Promise<void> {
  for (const [id, d] of this.docs)
    if (d.operatorId === operatorId && d.type === type && d.version === version && d.status === 'DRAFT') this.docs.delete(id)
}
async setOperatorVersionStatus(p): Promise<ConsentDocument[]> {
  const updated: ConsentDocument[] = []
  for (const [id, d] of this.docs) {
    if (d.operatorId === p.operatorId && d.type === p.type && d.version === p.version && d.status === p.from) {
      const next = { ...d, status: p.to, updatedAt: p.now, publishedAt: p.publishedAt ?? d.publishedAt }
      this.docs.set(id, next); updated.push(next)
    }
  }
  return updated
}
```

(Type the params to match the interface; the in-memory class already imports `ConsentDocument`.)

- [ ] **Step 5: Run tests, verify pass**

Run: `bun run --filter @kuruma/api test:integration consent-operator-repo`
Then: `bunx tsc -p packages/api --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories drizzle packages/api/tests/integration/consent-operator-repo.test.ts
git commit -m "feat(consent): operator-doc resolution + authoring repository methods"
```

---

## Task 5: Validators (shared)

**Files:**
- Create: `packages/shared/src/validators/consent-documents.ts`
- Test: `packages/shared/src/validators/consent-documents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { saveOperatorTermsDraftSchema } from './consent-documents'

describe('saveOperatorTermsDraftSchema', () => {
  it('requires en and accepts optional ja/zh', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' },
    })
    expect(r.success).toBe(true)
  })
  it('rejects a draft with no en locale', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      ja: { title: '規約', body: '同意します', acceptanceLabel: '同意する' },
    })
    expect(r.success).toBe(false)
  })
  it('rejects an empty en title', () => {
    const r = saveOperatorTermsDraftSchema.safeParse({
      en: { title: '', body: 'b', acceptanceLabel: 'a' },
    })
    expect(r.success).toBe(false)
  })
})
```

Run: `bun run --filter @kuruma/shared test consent-documents` → FAIL (module missing).

- [ ] **Step 2: Implement the schema**

Create `packages/shared/src/validators/consent-documents.ts`:

```typescript
import { z } from 'zod'

const localizedTermsSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  acceptanceLabel: z.string().min(1).max(200),
})
export type LocalizedTerms = z.infer<typeof localizedTermsSchema>

/** Operator save-draft input. `en` required; `ja`/`zh` optional (fall back to en at read). */
export const saveOperatorTermsDraftSchema = z.object({
  en: localizedTermsSchema,
  ja: localizedTermsSchema.optional(),
  zh: localizedTermsSchema.optional(),
  effectiveFrom: z.string().datetime().optional(),
})
export type SaveOperatorTermsDraftInput = z.infer<typeof saveOperatorTermsDraftSchema>

/** Platform-admin variant — may name the target operator via the picker. */
export const platformAdminSaveOperatorTermsDraftSchema = saveOperatorTermsDraftSchema.extend({
  operatorId: z.string().min(1).optional(),
})
```

Run test → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/validators/consent-documents.ts packages/shared/src/validators/consent-documents.test.ts
git commit -m "feat(consent): operator rental-terms authoring validators"
```

---

## Task 6: `OperatorTermsService` (state machine)

**Files:**
- Create: `packages/api/src/services/operator-terms.ts`
- Test: `packages/api/src/services/operator-terms.test.ts`

**Authz note (deviation from add-ons, deliberate):** every write is keyed by `(operatorId, version)`, and `operatorId` is resolved at the route via `resolveOperatorIdForWrite` (operator role → own clamped id; admin → `?operatorId=` or 422). There is no "load a global id then bind" seam, so the `assertFleetWriteWithinOperator` guard add-ons needs is unnecessary here — the operator-scoped filter provides the same isolation (a wrong/absent pick simply matches zero rows → 404/422). This preserves the §5.2 security property with less machinery.

- [ ] **Step 1: Write the failing service test**

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import { OperatorTermsService } from './operator-terms'

const OP = 'op_1'
const NOW = new Date('2026-06-01T00:00:00Z')
const draft = { en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' } }

describe('OperatorTermsService', () => {
  let repo: InMemoryConsentRepository
  let svc: OperatorTermsService
  beforeEach(() => { repo = new InMemoryConsentRepository([]); svc = new OperatorTermsService(repo) })

  it('creates a v1 DRAFT from en-only input', async () => {
    const r = await svc.saveDraft(OP, draft, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.version.version).toBe('v1')
    expect(r.version.status).toBe('DRAFT')
    expect(r.version.locales).toEqual(['en'])
  })

  it('replaces the existing draft version rather than creating v2', async () => {
    await svc.saveDraft(OP, draft, NOW)
    const r = await svc.saveDraft(OP, { en: { title: 'Terms 2', body: 'b', acceptanceLabel: 'ok' } }, NOW)
    expect(r.ok && r.version.version).toBe('v1')
    const list = await svc.list(OP)
    expect(list.ok && list.versions).toHaveLength(1)
    expect(list.ok && list.versions[0]?.title).toBe('Terms 2')
  })

  it('publish flips DRAFT→PUBLISHED and stamps publishedAt', async () => {
    await svc.saveDraft(OP, draft, NOW)
    const r = await svc.publish(OP, 'v1', NOW)
    expect(r.ok && r.version.status).toBe('PUBLISHED')
    expect(r.ok && r.version.publishedAt).toEqual(NOW)
  })

  it('publishing a nonexistent/non-draft version is 404', async () => {
    const r = await svc.publish(OP, 'v9', NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
  })

  it('a fresh draft after publish becomes v2', async () => {
    await svc.saveDraft(OP, draft, NOW)
    await svc.publish(OP, 'v1', NOW)
    const r = await svc.saveDraft(OP, draft, NOW)
    expect(r.ok && r.version.version).toBe('v2')
  })

  it('archive flips PUBLISHED→ARCHIVED', async () => {
    await svc.saveDraft(OP, draft, NOW)
    await svc.publish(OP, 'v1', NOW)
    const r = await svc.archive(OP, 'v1', NOW)
    expect(r.ok && r.version.status).toBe('ARCHIVED')
  })
})
```

Run: `bun run --filter @kuruma/api test operator-terms` → FAIL (module missing).

- [ ] **Step 2: Implement the service**

Create `packages/api/src/services/operator-terms.ts`:

```typescript
import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentDocStatus } from '@kuruma/shared/enums'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import type { ConsentDocument } from '../stores'
import type { ConsentRepository, NewConsentDocument } from '../repositories/types-consent'

const TYPE = 'OPERATOR_RENTAL_TERMS' as const
const LOCALES = ['en', 'ja', 'zh'] as const

export interface OperatorTermsVersion {
  version: string
  status: ConsentDocStatus
  effectiveFrom: Date
  publishedAt: Date | null
  locales: string[]
  title: string // en row (the always-present canonical locale)
  body: string
  acceptanceLabel: string
}

export type OperatorTermsResult =
  | { ok: true; version: OperatorTermsVersion }
  | { ok: false; error: string; status: number }
export type OperatorTermsListResult =
  | { ok: true; versions: OperatorTermsVersion[] }
  | { ok: false; error: string; status: number }

function versionNumber(v: string): number {
  const n = Number(v.replace(/^v/, ''))
  return Number.isFinite(n) ? n : 0
}

/** Group per-locale rows of one version into a display object (en is the canonical row). */
function toVersion(rows: ConsentDocument[]): OperatorTermsVersion {
  const en = rows.find((r) => r.locale === 'en') ?? rows[0]!
  return {
    version: en.version,
    status: en.status,
    effectiveFrom: en.effectiveFrom,
    publishedAt: en.publishedAt,
    locales: rows.map((r) => r.locale).sort(),
    title: en.title,
    body: en.body,
    acceptanceLabel: en.acceptanceLabel,
  }
}

export class OperatorTermsService {
  constructor(private readonly repo: ConsentRepository) {}

  async list(operatorId: string): Promise<OperatorTermsListResult> {
    const rows = await this.repo.findOperatorDocuments(operatorId, TYPE)
    const byVersion = new Map<string, ConsentDocument[]>()
    for (const r of rows) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r])
    const versions = [...byVersion.values()]
      .map(toVersion)
      .sort((a, b) => versionNumber(b.version) - versionNumber(a.version))
    return { ok: true, versions }
  }

  async saveDraft(
    operatorId: string, input: SaveOperatorTermsDraftInput, now: Date,
  ): Promise<OperatorTermsResult> {
    const existing = await this.repo.findOperatorDocuments(operatorId, TYPE)
    const draftVersion = existing.find((d) => d.status === 'DRAFT')?.version
    const version = draftVersion ?? this.nextVersion(existing)
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now

    if (draftVersion) await this.repo.deleteOperatorDraftRows(operatorId, TYPE, version)

    const rows: NewConsentDocument[] = LOCALES.flatMap((locale) => {
      const t = input[locale]
      if (!t) return []
      return [{
        operatorId, type: TYPE, version, locale,
        title: t.title, body: t.body, acceptanceLabel: t.acceptanceLabel,
        contentHash: computeContentHash(t),
        status: 'DRAFT' as const, effectiveFrom, publishedAt: null,
      }]
    })
    const created = await this.repo.createOperatorDocuments(rows)
    return { ok: true, version: toVersion(created) }
  }

  async publish(operatorId: string, version: string, now: Date): Promise<OperatorTermsResult> {
    const rows = await this.repo.setOperatorVersionStatus({
      operatorId, type: TYPE, version, from: 'DRAFT', to: 'PUBLISHED', publishedAt: now, now,
    })
    if (rows.length === 0) return { ok: false, error: 'No draft to publish for that version', status: 404 }
    return { ok: true, version: toVersion(rows) }
  }

  async archive(operatorId: string, version: string, now: Date): Promise<OperatorTermsResult> {
    const rows = await this.repo.setOperatorVersionStatus({
      operatorId, type: TYPE, version, from: 'PUBLISHED', to: 'ARCHIVED', publishedAt: null, now,
    })
    if (rows.length === 0) return { ok: false, error: 'No published version to archive', status: 404 }
    return { ok: true, version: toVersion(rows) }
  }

  private nextVersion(existing: ConsentDocument[]): string {
    const max = existing.reduce((m, d) => Math.max(m, versionNumber(d.version)), 0)
    return `v${max + 1}`
  }
}
```

Run test → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/operator-terms.ts packages/api/src/services/operator-terms.test.ts
git commit -m "feat(consent): OperatorTermsService DRAFT/PUBLISH/ARCHIVE state machine"
```

---

## Task 7: Authoring routes + wiring

**Files:**
- Create: `packages/api/src/routes/operator-terms.ts`
- Modify: `packages/api/src/index.ts` (construct service + `.route`)
- Test: `packages/api/tests/routes/operator-terms.test.ts`

- [ ] **Step 1: Write the failing route test**

Mirror `tests/routes/consent.test.ts` harness. Cover: operator creates + publishes + lists; a second operator cannot see the first's terms; admin without `?operatorId=` on a write gets 422.

```typescript
import { describe, expect, test } from 'vitest'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import { bearer, setupAuthEnv } from '../helpers/auth' // match existing import in consent.test.ts
import { createApp } from '../../src/index' // match how consent.test.ts builds the app

function makeApp() {
  setupAuthEnv()
  const consentRepo = new InMemoryConsentRepository([])
  const app = createApp({ consentRepo }) // extend createApp test-wiring to accept consentRepo (already does)
  return { app, consentRepo }
}
const operator = () => bearer({ sub: 'u_op', role: 'OPERATOR_OWNER', operatorId: 'op_A' })
const otherOp = () => bearer({ sub: 'u_op2', role: 'OPERATOR_OWNER', operatorId: 'op_B' })
const admin = () => bearer({ sub: 'u_admin', role: 'PLATFORM_ADMIN' })
const draft = { en: { title: 'Terms', body: 'You agree.', acceptanceLabel: 'I agree' } }

describe('operator-terms authoring routes', () => {
  test('operator saves a draft, publishes it, and lists it', async () => {
    const { app } = makeApp()
    const create = await app.request('/operator-terms', {
      method: 'POST', headers: { ...(await operator()), 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })
    expect(create.status).toBe(201)
    const { data } = await create.json()
    expect(data.version).toBe('v1')

    const pub = await app.request('/operator-terms/v1/publish', { method: 'POST', headers: await operator() })
    expect(pub.status).toBe(200)
    expect((await pub.json()).data.status).toBe('PUBLISHED')

    const list = await app.request('/operator-terms', { headers: await operator() })
    expect((await list.json()).data).toHaveLength(1)
  })

  test('an operator cannot see another operator’s terms', async () => {
    const { app } = makeApp()
    await app.request('/operator-terms', {
      method: 'POST', headers: { ...(await operator()), 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const list = await app.request('/operator-terms', { headers: await otherOp() })
    expect((await list.json()).data).toHaveLength(0)
  })

  test('a platform admin writing without ?operatorId= is 422', async () => {
    const { app } = makeApp()
    const res = await app.request('/operator-terms', {
      method: 'POST', headers: { ...(await admin()), 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })
    expect(res.status).toBe(422)
  })
})
```

Run: `bun run --filter @kuruma/api test operator-terms` (routes) → FAIL.

- [ ] **Step 2: Implement the router**

Create `packages/api/src/routes/operator-terms.ts` (mirror `routes/add-ons.ts` structure: `requireUser`, `FLEET_WRITE_ROLES` gate, `requireAuth()` at prefix, `parseScopedCreate`, `resolveWriteOperatorId`, `ok`/`fail`/`failResult`, `parseLocale`):

```typescript
import { Hono } from 'hono'
import {
  platformAdminSaveOperatorTermsDraftSchema, saveOperatorTermsDraftSchema,
} from '@kuruma/shared/validators/consent-documents'
import { FLEET_WRITE_ROLES } from '../auth/roles'
import { requireAuth, requireUser } from '../auth/middleware' // match add-ons.ts imports
import { toCallerContext } from '../tenancy'
import type { ResolveWriteOperatorId } from '../tenancy'
import { fail, ok, parseScopedCreate } from './helpers'
import { operatorReadScope } from '../tenancy' // match add-ons’ read-scope import
import type { OperatorTermsService } from '../services/operator-terms'

export function createOperatorTermsRoutes(
  service: OperatorTermsService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
): Hono {
  return new Hono()
    .use('/operator-terms', requireAuth())
    .use('/operator-terms/*', requireAuth())

    .get('/operator-terms', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      // Operator role → own id; admin → the picked operator (?operatorId=), else nothing to show.
      const operatorId = operatorReadScope(ctx).kind === 'all'
        ? c.req.query('operatorId')
        : await resolveWriteOperatorId(ctx)
      if (!operatorId) return ok(c, [])
      const result = await service.list(operatorId)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.versions)
    })

    .post('/operator-terms', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(c, ctx,
        { operator: saveOperatorTermsDraftSchema, admin: platformAdminSaveOperatorTermsDraftSchema },
        resolveWriteOperatorId)
      if (!parsed.ok) return parsed.response
      const result = await service.saveDraft(parsed.operatorId, parsed.data, new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version, 201)
    })

    .post('/operator-terms/:version/publish', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const operatorId = await resolveWriteOperatorId(ctx, c.req.query('operatorId'))
      const result = await service.publish(operatorId, c.req.param('version'), new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version)
    })

    .delete('/operator-terms/:version', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const operatorId = await resolveWriteOperatorId(ctx, c.req.query('operatorId'))
      const result = await service.archive(operatorId, c.req.param('version'), new Date())
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.version)
    })
}
```

Note: `resolveWriteOperatorId` throws `OperatorRequiredError` for an admin with no `operatorId` — confirm `index.ts`'s error middleware maps it to 422 (add-ons rely on the same; grep `OperatorRequiredError`). If publish/delete need the 422 mapped explicitly, wrap in try/catch mirroring add-ons. Verify against the add-ons create path behavior.

- [ ] **Step 3: Wire in `index.ts`**

Near the other service construction (add-ons/insurance, ~line 488):

```typescript
const operatorTermsService = new OperatorTermsService(consentRepo)
```

Add the import (`import { OperatorTermsService } from './services/operator-terms'`, `import { createOperatorTermsRoutes } from './routes/operator-terms'`) and mount alongside add-ons (~line 615):

```typescript
.route('/', createOperatorTermsRoutes(operatorTermsService, resolveWriteOperatorId))
```

`consentRepo` is already constructed in the composition root (used by `ConsentService`); reuse it.

- [ ] **Step 4: Run tests + tsc + boundaries**

Run: `bun run --filter @kuruma/api test operator-terms`
Then: `bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api lint:boundaries`
Expected: PASS; boundaries clean (routes import services + helpers + tenancy only).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/operator-terms.ts packages/api/src/index.ts packages/api/tests/routes/operator-terms.test.ts
git commit -m "feat(consent): operator rental-terms authoring routes"
```

---

## Task 8: Feature flag `OPERATOR_TERMS`

**Files:**
- Modify: `packages/shared/src/feature-flags/registry.ts`
- Modify: `packages/web/src/vite/config/feature-flags-runtime.ts` (BUILD_TIME_READERS)
- Modify: `packages/web/src/vite/vite-env.d.ts`
- Test: `packages/shared/src/feature-flags/registry.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```typescript
import { FEATURE_FLAGS } from './registry'
it('registers OPERATOR_TERMS as a build-time web flag', () => {
  expect(FEATURE_FLAGS.OPERATOR_TERMS).toMatchObject({ env: 'VITE_FEATURE_OPERATOR_TERMS' })
  expect(FEATURE_FLAGS.OPERATOR_TERMS.serverOnly).toBeUndefined()
})
```

Run: `bun run --filter @kuruma/shared test registry` → FAIL.

- [ ] **Step 2: Register the flag (mirror the `REVIEWS` entry)**

In `packages/shared/src/feature-flags/registry.ts`, add to `REGISTRY`:

```typescript
  OPERATOR_TERMS: {
    env: 'VITE_FEATURE_OPERATOR_TERMS',
    label: 'Operator-authored rental terms',
    runtimeControlled: true,
  },
```

In `packages/web/src/vite/config/feature-flags-runtime.ts`, add to `BUILD_TIME_READERS`:

```typescript
  OPERATOR_TERMS: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_TERMS),
```

In `packages/web/src/vite/vite-env.d.ts`, add to `ImportMetaEnv`:

```typescript
  readonly VITE_FEATURE_OPERATOR_TERMS?: string
```

- [ ] **Step 3: Run test + tsc**

Run: `bun run --filter @kuruma/shared test registry && bunx tsc -p packages/web --noEmit`
Expected: PASS. (Prod sets no `VITE_FEATURE_OPERATOR_TERMS`, so the flag is OFF everywhere by default — the slice ships dark.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/feature-flags packages/web/src/vite/config/feature-flags-runtime.ts packages/web/src/vite/vite-env.d.ts
git commit -m "feat(consent): OPERATOR_TERMS feature flag (default off)"
```

---

## Task 9: Web data layer (`operator-terms/api.ts`)

**Files:**
- Create: `packages/web/src/vite/operator-terms/api.ts`
- Create: `packages/web/src/vite/operator-terms/index.ts` (barrel)
- Test: `packages/web/src/vite/operator-terms/api.test.ts`

Mirror `vite/operator-insurance/api.ts` (uses `getApiBaseUrl`, `unwrap`, `writeJson`, `buildScopeParam`, `operatorQuery`, `WithOperatorId`).

- [ ] **Step 1: Write the failing test** — assert `saveOperatorTermsDraft` POSTs the bundle and `publishOperatorTermsVersion` targets the version path with `?operatorId=` when picked. (Mirror the mock-fetch shape used in `operator-add-ons/api.test.ts`; include ALL schema-required fields in the mocked response — an unfaithful mock that omits a field turns CI red via a floating unhandled rejection.)

```typescript
import { describe, expect, it, vi } from 'vitest'
import { publishOperatorTermsVersion, saveOperatorTermsDraft } from './api'

const version = {
  version: 'v1', status: 'DRAFT', effectiveFrom: '2026-06-01T00:00:00.000Z',
  publishedAt: null, locales: ['en'], title: 'T', body: 'B', acceptanceLabel: 'I agree',
}
function mockOk() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: version }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
}

describe('operator-terms api', () => {
  it('saves a draft with the locale bundle', async () => {
    const f = mockOk(); vi.stubGlobal('fetch', f)
    await saveOperatorTermsDraft({ en: { title: 'T', body: 'B', acceptanceLabel: 'I agree' } }, 'csrf')
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
  })
  it('binds publish to the picked operator', async () => {
    const f = mockOk(); vi.stubGlobal('fetch', f)
    await publishOperatorTermsVersion('v1', 'csrf', 'op_A')
    expect(f.mock.calls[0]?.[0]).toContain('/operator-terms/v1/publish?operatorId=op_A')
  })
})
```

- [ ] **Step 2: Implement the api module**

Create `packages/web/src/vite/operator-terms/api.ts`:

```typescript
import { queryOptions } from '@tanstack/react-query'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import { z } from 'zod'
import { getApiBaseUrl, unwrap, writeJson } from '../api/client' // match operator-insurance import paths
import type { WithOperatorId } from '../operator-context'
import { buildScopeParam } from '../operator-context'

export const operatorTermsVersionSchema = z.object({
  version: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  effectiveFrom: z.string(),
  publishedAt: z.string().nullable(),
  locales: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  acceptanceLabel: z.string(),
})
export type OperatorTermsVersionData = z.infer<typeof operatorTermsVersionSchema>

export const OPERATOR_TERMS_QUERY_KEY = ['operator-terms'] as const

export async function fetchOperatorTerms(pickedOperatorId?: string): Promise<OperatorTermsVersionData[]> {
  const res = await fetch(`${getApiBaseUrl()}/operator-terms?${buildScopeParam(pickedOperatorId)}`, {
    credentials: 'include',
  })
  return unwrap(res, operatorTermsVersionSchema.array())
}
export function operatorTermsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...OPERATOR_TERMS_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchOperatorTerms(pickedOperatorId),
  })
}

function operatorQuery(pickedOperatorId?: string): string {
  return pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
}

export async function saveOperatorTermsDraft(
  input: WithOperatorId<SaveOperatorTermsDraftInput>, csrfToken: string,
): Promise<OperatorTermsVersionData> {
  return writeJson('/operator-terms', 'POST', input, csrfToken)
}
export async function publishOperatorTermsVersion(
  version: string, csrfToken: string, pickedOperatorId?: string,
): Promise<OperatorTermsVersionData> {
  return writeJson(`/operator-terms/${encodeURIComponent(version)}/publish${operatorQuery(pickedOperatorId)}`, 'POST', {}, csrfToken)
}
export async function archiveOperatorTermsVersion(
  version: string, csrfToken: string, pickedOperatorId?: string,
): Promise<OperatorTermsVersionData> {
  const res = await fetch(
    `${getApiBaseUrl()}/operator-terms/${encodeURIComponent(version)}${operatorQuery(pickedOperatorId)}`,
    { method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  return unwrap(res, operatorTermsVersionSchema)
}
```

Create the barrel `packages/web/src/vite/operator-terms/index.ts` re-exporting the api + view (add the view after Task 10). Verify the exact import paths for `getApiBaseUrl`/`unwrap`/`writeJson` against `operator-insurance/api.ts` (they may live in a shared `../api/client` or similar).

- [ ] **Step 3: Run test → PASS; commit**

```bash
git add packages/web/src/vite/operator-terms
git commit -m "feat(consent): web data layer for operator rental-terms"
```

---

## Task 10: Web operator surface (form, view, route, nav, i18n)

**Files:**
- Create: `packages/web/src/vite/operator-terms/TermsForm.tsx`, `OperatorTermsView.tsx`, `SaveTermsDialog.tsx`
- Create: `packages/web/src/routes/$locale/_business/manage/terms.tsx`
- Modify: `packages/web/src/vite/operator-context/operator-context.ts:97-113` (add route id)
- Modify: operator sidebar nav (flag-gated link)
- Modify: `packages/web/messages/{en,ja,zh}.json` (`business.terms.*`)
- Test: `packages/web/src/vite/operator-terms/TermsForm.test.tsx`, `terms.guard.test.tsx`

- [ ] **Step 1: i18n messages first** — add `business.terms` to all three message files (mirror `business.insurance` keys). Example `en.json`:

```json
"terms": {
  "title": "Rental terms",
  "subtitle": "Write the rental agreement renters accept when they book your cars.",
  "addOption": "New terms",
  "editDraft": "Edit draft",
  "publish": "Publish",
  "archive": "Archive",
  "empty": "No rental terms yet. Renters currently see only the platform terms.",
  "loadError": "Couldn't load rental terms",
  "retry": "Try again",
  "status": { "DRAFT": "Draft", "PUBLISHED": "Published", "ARCHIVED": "Archived" },
  "form": {
    "localeEn": "English (required)", "localeJa": "Japanese", "localeZh": "Chinese",
    "localeNudge": "Tourists see English wherever Japanese or Chinese is blank. Fill a language fully to use it.",
    "docTitle": "Title", "body": "Terms text", "acceptanceLabel": "Agreement checkbox label",
    "save": "Save draft", "saving": "Saving...", "cancel": "Cancel"
  }
}
```

Add matching `ja.json`/`zh.json` groups (translate values; keep keys identical). Verify no key drift after any merge.

- [ ] **Step 2: `TermsForm.tsx`** — mirror `operator-insurance/InsuranceForm.tsx`, but with three `<fieldset>` locale groups (en/ja/zh), each with `title`/`body`(textarea)/`acceptanceLabel` inputs. Define:

```typescript
export interface TermsFormValues {
  titleEn: string; bodyEn: string; labelEn: string
  titleJa: string; bodyJa: string; labelJa: string
  titleZh: string; bodyZh: string; labelZh: string
}
```

Add a pure `buildTermsBundle` (co-locate as `name-bundle.ts` twin):

```typescript
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'

function locale(t: string, b: string, l: string) {
  const [tt, bb, ll] = [t.trim(), b.trim(), l.trim()]
  return tt && bb && ll ? { title: tt, body: bb, acceptanceLabel: ll } : undefined // all-or-omit
}
export function buildTermsBundle(v: TermsFormValues): SaveOperatorTermsDraftInput {
  const en = locale(v.titleEn, v.bodyEn, v.labelEn)
  if (!en) throw new Error('English terms are required')
  const out: SaveOperatorTermsDraftInput = { en }
  const ja = locale(v.titleJa, v.bodyJa, v.labelJa); if (ja) out.ja = ja
  const zh = locale(v.titleZh, v.bodyZh, v.labelZh); if (zh) out.zh = zh
  return out
}
```

Test `buildTermsBundle`: en-only → `{ en }`; partial ja (title only) → ja omitted; full ja → included.

- [ ] **Step 3: `OperatorTermsView.tsx` + `SaveTermsDialog.tsx`** — mirror `OperatorInsuranceView` + `AddInsuranceDialog`/`EditInsuranceDialog`. The view lists versions (status badge, effectiveFrom), shows a "New terms"/"Edit draft" button (there is at most one DRAFT), a Publish action on the DRAFT, and Archive on PUBLISHED versions. Mutations call the Task 9 api, invalidate `OPERATOR_TERMS_QUERY_KEY`, and thread `scope.pickedOperatorId`. Gate write controls on `scope.canWrite` (mirror insurance).

- [ ] **Step 4: Route with flag `beforeLoad`** — create `packages/web/src/routes/$locale/_business/manage/terms.tsx`, mirroring `insurance.tsx` for loader/scope, and `templates.tsx` for the flag guard:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router'
import { featureFlagsQueryOptions } from '../../../../vite/config' // match templates.tsx path
import { resolveFeatureFlag } from '../../../../vite/config/feature-flags-runtime'
import { operatorTermsQueryOptions } from '../../../../vite/operator-terms'
// ...view + skeleton + error imports

export const Route = createFileRoute('/$locale/_business/manage/terms')({
  beforeLoad: async ({ context, params }) => {
    const overrides = await context.queryClient.ensureQueryData(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'OPERATOR_TERMS')) {
      throw redirect({ to: '/$locale/dashboard', params: { locale: params.locale } })
    }
  },
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({ operator: search.operator }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(operatorTermsQueryOptions(deps.operator)),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorTermsError,
  component: OperatorTermsRoute,
})
```

`OperatorTermsRoute` uses `useOperatorScope()` + `useSuspenseQuery(operatorTermsQueryOptions(scope.pickedOperatorId))` (mirror `insurance.tsx`).

- [ ] **Step 5: Register route in the picker set + nav**

In `operator-context.ts`, add `'/$locale/_business/manage/terms'` to `OPERATOR_CONTEXT_ROUTE_IDS`.
In the operator/business sidebar (find the counterpart to `AdminSidebar` — grep the sidebar that lists `manage/insurance`), add a flag-gated nav item using `useFeatureFlag('OPERATOR_TERMS')`, following the `FLAG_GATED_ITEMS` pattern.

- [ ] **Step 6: Guard test** — `terms.guard.test.tsx`: pin the redirect target when the flag is OFF (mirror `templates.guard.test.ts` from #1437 — assert via `error.options.to`, not `error.to`), and that it admits when the override is ON.

- [ ] **Step 7: Build (regenerate routeTree) + typecheck + test**

Run: `bun run --filter @kuruma/web build && bunx tsc -p packages/web --noEmit && bun run --filter @kuruma/web test operator-terms`
(A new route requires `vite build` to regenerate `routeTree.gen.ts` before typecheck — per AGENTS.md.)
Then: `bun run lint:modules` (web barrels).

- [ ] **Step 8: Commit**

```bash
git add packages/web
git commit -m "feat(consent): operator rental-terms authoring web surface (flag-gated)"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §4.1 enum + cardinality → Task 1. §4.2 operatorId column + fk index → Task 2. §4.3 two partial uniques → Task 2 (real-pg tested). §5.1 immutability trigger → Task 3 (real-pg tested). §5.3 operator resolution methods → Task 4. §5.4 i18n en-required/ja-zh-optional → validators (Task 5) + form all-or-omit (Task 10). §5.2 authz → Task 6/7 (resolveOperatorIdForWrite scoping; deviation from `assertFleetWriteWithinOperator` justified in Task 6 note). §9 flag-gating → Task 8 + Task 10 `beforeLoad`.
- **Deferred to Slice B (correctly out of this plan):** §4.4 liability CHECK widen, §4.6 `(bookingId, consentType)` seal, §6 booking-create tx wiring, `findBookingAcceptance(+consentType)`, §6 accept-endpoint hardening, §7 `CONSENT_SIGNING_KEY` presence check. Slice A creates NO acceptance rows, so none of these are needed yet.

**Type consistency:** `OperatorTermsVersion` shape is identical across service (Task 6), api zod schema (Task 9), and the form/view (Task 10). `NewConsentDocument` is defined once (Task 4) and consumed by service (Task 6). `SaveOperatorTermsDraftInput` flows validator → service → web unchanged.

**Open verification points for the implementer (confirm against live code, don't assume):**
1. `resolveWriteOperatorId`'s exact import/type name in `index.ts` and whether `OperatorRequiredError` is mapped to 422 by the error middleware for the `publish`/`delete` handlers (add-ons prove the create path; confirm the by-query path).
2. Exact import paths for web `getApiBaseUrl`/`unwrap`/`writeJson` and `featureFlagsQueryOptions` (Tasks 9-10) — mirror `operator-insurance`/`templates.tsx`.
3. The business/operator sidebar component path (Task 10 Step 5).
4. The `ConsentDocument` test-factory locations that need `operatorId: null` after Task 2.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-07-operator-usage-consent-slice-a.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Real-pg tasks (2, 3, 4) require a throwaway Postgres on `DATABASE_URL`; the plan's tests follow the existing `postgres-js` integration pattern.
