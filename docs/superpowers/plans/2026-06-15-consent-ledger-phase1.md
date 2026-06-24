# Consent Ledger — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the consent-ledger core — two immutable-document/append-acceptance tables, repositories, `ConsentService` + `ConsentGateService` with Tier-1 record signing, and seed the four legal documents (en/ja/zh) — with zero route/middleware wiring (that is Phase 2–4).

**Architecture:** Follows the repo's `routes → services → repositories` + DI composition root. New schema lives in `packages/shared/src/db/consent.ts`; enums/cardinality in `packages/shared/src/enums.ts`; domain interfaces in `packages/api/src/stores.ts`; repo interface in `repositories/types.ts` with Drizzle + InMemory implementations; services are pure (FC/IS) and receive repository **interfaces** by constructor. Tier-1 signing is an HMAC-SHA256 over a deterministic canonical payload, key in CF secret, behind a single function so it can be upgraded to asymmetric later.

**Tech Stack:** Bun · Drizzle (Postgres `timestamptz`/`jsonb`/`pgEnum`) · Hono on CF Workers (`nodejs_compat` → `node:crypto`) · Vitest. Source spec: `docs/superpowers/specs/2026-06-15-consent-ledger-design.md` (v1.0 APPROVED).

---

## Scope (Phase 1 only)

**In:** enums + cardinality map · `consent_documents` + `consent_acceptances` schema + migration · domain types · Tier-1 signing util · `ConsentRepository` (interface + Drizzle + InMemory) + DI wiring · `ConsentService` (idempotent `recordAcceptance` + cohort-first re-consent query) · `ConsentGateService` (pure policy decision) · seed the 4 document types in en/ja/zh.

**Out (later phases):** API route + web clickwrap gate (Phase 2) · operator-agreement onboarding gate + operator-bindability authz (Phase 3) · migrating `bookings.disclaimer*` into the ledger + `IMPORTED` backfill + dual-write/drop (Phase 4) · Tier-2 e-sign · DB-level no-UPDATE/no-DELETE triggers (§4.3 hardening) · request Zod validators (added with the routes that need them).

## Design decisions resolved for this plan

- **Signing primitive = HMAC-SHA256** (symmetric, one CF secret `CONSENT_SIGNING_KEY`, matches the existing HS256 JWT). Tamper-evident and verifiable by any holder of the key. Spec §5 wants "independently verifiable" — if true third-party verification (without sharing the secret) is later required, swap the body of `signAcceptanceRecord()` for Ed25519/WebCrypto; the seam (`recordSignature` + `signingKeyId`) is unchanged. **DECIDED (owner, 2026-06-15): HMAC-SHA256.**
- **Operator-bindability authz** (user may bind operator via an *active* membership) is enforced where `OPERATOR_AGREEMENT` is accepted — **Phase 3**. Phase 1 `recordAcceptance` fully handles `RENTER_TOS` / `PRIVACY_POLICY` / `RENTER_LIABILITY`; it enforces subject-shape + document-validity + idempotency + signing for all types, but does not yet resolve memberships.
- **Seed legal copy:** `RENTER_LIABILITY` body/label are the *exact* current i18n strings (so Phase 4 backfill matches). ToS / privacy / operator-agreement bodies are concise **MVP copy pending counsel review** — real, buildable text, flagged in the file.

## File map

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/enums.ts` | const-tuple SSoT + `CONSENT_CARDINALITY` | modify |
| `packages/shared/src/db/consent.ts` | `pgEnum`s + 2 tables + constraints | create |
| `packages/shared/src/db/schema.ts` | barrel | modify (1 line) |
| `packages/shared/package.json` | `exports` subpath for `./lib/consent-canonical` | modify (1 line) |
| `packages/shared/src/db/seed-data/consent-documents.ts` | 12 seed rows | create |
| `packages/shared/src/db/seed-data/index.ts` | re-export | modify (1 line) |
| `packages/shared/src/db/seed.ts` | seeder loop | modify |
| `packages/shared/src/lib/consent-canonical.ts` | shared canonicalize + `computeContentHash` | create |
| `packages/api/src/stores.ts` | `ConsentDocument` / `ConsentAcceptance` interfaces | modify |
| `packages/api/src/services/consent-signing.ts` | Tier-1 `signAcceptanceRecord` | create |
| `packages/api/src/repositories/types.ts` | `ConsentRepository` interface + `Repos` member | modify |
| `packages/api/src/repositories/drizzle/consent.ts` | Drizzle impl + mappers | create |
| `packages/api/src/repositories/in-memory/consent.ts` | InMemory impl (enforces uniques) | create |
| `packages/api/src/composition/repositories.ts` | wire into `buildDrizzleRepos` + `buildInMemoryRepos` | modify |
| `packages/api/src/services/consent.ts` | `ConsentService` | create |
| `packages/api/src/services/consent-gate.ts` | `ConsentGateService` | create |

## Gotchas (read before starting)

- **Tests run on Vitest, not `bun test`.** `vi.stubEnv` no-ops under the bun runner. Always gate with `bun run --filter @kuruma/<pkg> test`.
- **pgEnum change → run ALL package tests** — `packages/shared/src/db/schema.test.ts` has an `enumValues` tripwire (#681 lesson).
- **Schema flow is sacred:** `bun run db:generate --name <x>` → `bun run db:migrate` → `bun run db:verify` (3 green). Never hand-edit `drizzle/`. Re-read files after Biome reformats or `Edit` fails on stale `old_string`.
- **`noUncheckedIndexedAccess` is on** — `rows[0]` is `T | undefined`; guard it.
- **FK-covering-index lint** (`bun run lint:fk-indexes`) requires every FK column to be a PK or the **leading** column of some index. Trailing columns don't count.
- **Boundary lint** (`bun run --filter @kuruma/api lint:boundaries`): services import only `repositories/types`; concrete repos constructed only in `composition/`.
- **PG error codes are nested.** postgres-js/neon wrap the `PostgresError` under `err.cause`; drizzle does not re-surface `.code`. NEVER read `.code` directly — use `pgErrorCode(err)`/`pgConstraintName(err)` from `packages/api/src/pg-errors.ts` (`PG_ERROR.UNIQUE_VIOLATION = '23505'`). In-memory repos must throw a PG-shaped error (top-level `.code`) so both paths flow through one detector — see `repositories/in-memory/booking.ts`.
- **Typecheck script is `typecheck`** (`tsc --noEmit`): `bun run --filter @kuruma/api typecheck`, `bun run --filter @kuruma/shared typecheck`.
- **`Repos` has THREE builders** (`buildOverrideRepos`, `buildDrizzleRepos`, `buildInMemoryRepos`); a new member fails to compile until all three supply it (#635). `buildOverrideRepos` backs the route/integration suite.

---

## Task 0: Setup — rebase, install, claim

- [ ] **Step 1: Refresh the branch onto current trunk**

```bash
cd /Users/jack/Dev/kuruma-consent-ledger
git fetch origin
git rebase origin/marketplace-pivot
bun install
```
Expected: clean rebase (the spec commit is the only delta) and a green install.

- [ ] **Step 2: Sanity-check the baseline is green**

```bash
bun run --filter @kuruma/shared test
bun run --filter @kuruma/api test
```
Expected: PASS (establishes a clean pre-change baseline).

- [ ] **Step 3: Claim the issue**

```bash
gh issue edit 877 --add-label in-progress
```

---

## Task 1: Enums + cardinality map

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Test: `packages/shared/src/enums.test.ts` (create if absent, else append)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/enums.test.ts
import { describe, expect, it } from 'vitest'
import {
  CONSENT_CARDINALITY,
  CONSENT_DOC_STATUSES,
  CONSENT_METHODS,
  CONSENT_TYPES,
} from './enums'

describe('consent enums', () => {
  it('exposes the four consent document types', () => {
    expect(CONSENT_TYPES).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
      'RENTER_LIABILITY',
      'OPERATOR_AGREEMENT',
    ])
  })

  it('document status is the DRAFT→PUBLISHED→ARCHIVED lifecycle', () => {
    expect(CONSENT_DOC_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  })

  it('acceptance methods are clickwrap, e-sign, imported', () => {
    expect(CONSENT_METHODS).toEqual(['CLICKWRAP', 'ESIGN', 'IMPORTED'])
  })

  it('maps liability to per-event and the rest to once-per-subject', () => {
    expect(CONSENT_CARDINALITY.RENTER_LIABILITY).toBe('PER_EVENT')
    expect(CONSENT_CARDINALITY.RENTER_TOS).toBe('ONCE_PER_SUBJECT')
    expect(CONSENT_CARDINALITY.PRIVACY_POLICY).toBe('ONCE_PER_SUBJECT')
    expect(CONSENT_CARDINALITY.OPERATOR_AGREEMENT).toBe('ONCE_PER_SUBJECT')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bun run --filter @kuruma/shared test enums`
Expected: FAIL — `CONSENT_TYPES` is not exported.

- [ ] **Step 3: Add the enums + cardinality (append to `enums.ts`)**

```typescript
// --- Consent ledger (issue #877) ---
export const CONSENT_TYPES = [
  'RENTER_TOS',
  'PRIVACY_POLICY',
  'RENTER_LIABILITY',
  'OPERATOR_AGREEMENT',
] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

export const CONSENT_DOC_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export type ConsentDocStatus = (typeof CONSENT_DOC_STATUSES)[number]

export const CONSENT_METHODS = ['CLICKWRAP', 'ESIGN', 'IMPORTED'] as const
export type ConsentMethod = (typeof CONSENT_METHODS)[number]

/** §4.2 — derived config, never a stored column. Drives the re-consent query. */
export type ConsentCardinality = 'ONCE_PER_SUBJECT' | 'PER_EVENT'
export const CONSENT_CARDINALITY: Record<ConsentType, ConsentCardinality> = {
  RENTER_TOS: 'ONCE_PER_SUBJECT',
  PRIVACY_POLICY: 'ONCE_PER_SUBJECT',
  OPERATOR_AGREEMENT: 'ONCE_PER_SUBJECT',
  RENTER_LIABILITY: 'PER_EVENT',
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun run --filter @kuruma/shared test enums`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/enums.test.ts
git commit -m "feat(consent): add consent enums + cardinality map (#877)"
```

---

## Task 2: Schema — two tables + migration

**Files:**
- Create: `packages/shared/src/db/consent.ts`
- Modify: `packages/shared/src/db/schema.ts` (barrel)
- Test: `packages/shared/src/db/schema.test.ts` (append enum assertions)

- [ ] **Step 1: Write the schema file** (`packages/shared/src/db/consent.ts`)

```typescript
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  CONSENT_DOC_STATUSES,
  CONSENT_METHODS,
  CONSENT_TYPES,
} from '../enums'
import { operators, users } from './auth'
import { operatorMemberships } from './provider-access'
import { bookings } from './booking'

export const consentTypeEnum = pgEnum('consent_type', CONSENT_TYPES)
export const consentDocStatusEnum = pgEnum('consent_doc_status', CONSENT_DOC_STATUSES)
export const consentMethodEnum = pgEnum('consent_method', CONSENT_METHODS)

/** Versioned, immutable-once-PUBLISHED legal documents (the archived "what they were shown"). */
export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: text('id').primaryKey(),
    type: consentTypeEnum('type').notNull(),
    version: text('version').notNull(),
    locale: text('locale').notNull(),
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
    unique('consent_documents_type_version_locale_unique').on(t.type, t.version, t.locale),
    // Redundant vs PK, but it is the composite-FK target that keeps acceptances' denormalized
    // `consentType` honest (§4.1 sync seal).
    unique('consent_documents_id_type_unique').on(t.id, t.type),
  ],
)

/** Append-only acceptance ledger. */
export const consentAcceptances = pgTable(
  'consent_acceptances',
  {
    id: text('id').primaryKey(),
    documentId: text('documentId').notNull(),
    consentType: consentTypeEnum('consentType').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    operatorId: text('operatorId').references(() => operators.id, { onDelete: 'restrict' }),
    operatorMembershipId: text('operatorMembershipId').references(() => operatorMemberships.id, {
      onDelete: 'restrict',
    }),
    actorRole: text('actorRole'),
    bookingId: text('bookingId').references(() => bookings.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('acceptedAt', { withTimezone: true }).notNull(),
    context: jsonb('context').$type<Record<string, unknown>>(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    method: consentMethodEnum('method').notNull().default('CLICKWRAP'),
    recordSignature: text('recordSignature'),
    signingKeyId: text('signingKeyId'),
    signatureRef: text('signatureRef'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sync seal: snapshot consentType cannot diverge from the referenced document's real type.
    foreignKey({
      columns: [t.documentId, t.consentType],
      foreignColumns: [consentDocuments.id, consentDocuments.type],
      name: 'consent_acceptances_document_type_fk',
    }).onDelete('restrict'),
    // Row-shape invariants (DB-enforced, not service-promised).
    check(
      'consent_liability_booking_chk',
      sql`(${t.consentType} = 'RENTER_LIABILITY') = (${t.bookingId} IS NOT NULL)`,
    ),
    check(
      'consent_operator_agreement_chk',
      sql`(${t.consentType} = 'OPERATOR_AGREEMENT') = (${t.operatorId} IS NOT NULL)`,
    ),
    check(
      'consent_membership_implies_operator_chk',
      sql`${t.operatorMembershipId} IS NULL OR ${t.operatorId} IS NOT NULL`,
    ),
    // Three disjoint idempotency seals (§4.1). documentId pins version+locale, so a new
    // version is a different row (re-consent history, not a dup).
    uniqueIndex('consent_unique_booking_liability')
      .on(t.bookingId)
      .where(sql`${t.bookingId} IS NOT NULL`),
    uniqueIndex('consent_unique_user_document')
      .on(t.userId, t.documentId)
      .where(sql`${t.bookingId} IS NULL AND ${t.operatorId} IS NULL`),
    uniqueIndex('consent_unique_operator_document')
      .on(t.operatorId, t.documentId)
      .where(sql`${t.operatorId} IS NOT NULL`),
    // FK-covering indexes (lint:fk-indexes). userId/operatorId/bookingId are leading in the
    // partial uniques above; these cover the composite FK + bare documentId, and membership.
    index('consent_acceptances_document_type_idx').on(t.documentId, t.consentType),
    index('consent_acceptances_membership_idx').on(t.operatorMembershipId),
  ],
)
```

> **Verified (review):** `users`/`operators` → `db/auth.ts`; `operatorMemberships` → `db/provider-access.ts`; `bookings` → `db/booking.ts`. The composite-FK target needs the `unique(id, type)` declared above on `consent_documents`.

- [ ] **Step 2: Register in the barrel** — add to `packages/shared/src/db/schema.ts`:

```typescript
export * from './consent'
```

- [ ] **Step 3: Append the enum tripwire** to `packages/shared/src/db/schema.test.ts`

```typescript
it('registers the consent pg enums', () => {
  expect(consentTypeEnum.enumValues).toEqual([
    'RENTER_TOS',
    'PRIVACY_POLICY',
    'RENTER_LIABILITY',
    'OPERATOR_AGREEMENT',
  ])
  expect(consentDocStatusEnum.enumValues).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  expect(consentMethodEnum.enumValues).toEqual(['CLICKWRAP', 'ESIGN', 'IMPORTED'])
})
```
(Add the import: `import { consentDocStatusEnum, consentMethodEnum, consentTypeEnum } from './consent'`.)

- [ ] **Step 4: Generate + verify + migrate**

```bash
bun run db:generate --name add_consent_ledger
bun run db:verify          # 3 green checks
bun run db:migrate
bun run db:verify          # still green, now incl. DB-count check
bun run lint:fk-indexes    # all consent FKs covered
```
Expected: a new `drizzle/00NN_*.sql` containing the two `CREATE TABLE`s, three enums, composite FK, three CHECKs, partial uniques, and covering indexes. `db:verify` and `lint:fk-indexes` both pass. If `lint:fk-indexes` flags a column, add a plain `index().on(<col>)` for it and re-generate.

- [ ] **Step 5: Run shared tests (pgEnum tripwire)**

```bash
bun run --filter @kuruma/shared test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/db/consent.ts packages/shared/src/db/schema.ts \
  packages/shared/src/db/schema.test.ts drizzle/
git commit -m "feat(consent): consent_documents + consent_acceptances schema + migration (#877)"
```

---

## Task 3: Domain interfaces

**Files:**
- Modify: `packages/api/src/stores.ts`

- [ ] **Step 1: Append domain interfaces** (Date-typed, drizzle-free — mirror `AddOn`/`Booking`)

```typescript
import type { ConsentDocStatus, ConsentMethod, ConsentType } from '@kuruma/shared/enums'

export interface ConsentDocument {
  id: string
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
  createdAt: Date
  updatedAt: Date
}

export interface ConsentAcceptance {
  id: string
  documentId: string
  consentType: ConsentType
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  acceptedAt: Date
  context: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  method: ConsentMethod
  recordSignature: string | null
  signingKeyId: string | null
  signatureRef: string | null
  createdAt: Date
}
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter @kuruma/api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/stores.ts
git commit -m "feat(consent): ConsentDocument + ConsentAcceptance domain types (#877)"
```

---

## Task 4: Canonicalization + Tier-1 signing

Canonicalization is shared (the seed computes `contentHash`; the API signs acceptances) → it lives in `@kuruma/shared`. The HMAC step is API-only (it reads the CF secret).

**Files:**
- Create: `packages/shared/src/lib/consent-canonical.ts`
- Create: `packages/api/src/services/consent-signing.ts`
- Test: `packages/shared/src/lib/consent-canonical.test.ts`, `packages/api/src/services/consent-signing.test.ts`

- [ ] **Step 1: Write the canonicalization test**

```typescript
// packages/shared/src/lib/consent-canonical.test.ts
import { describe, expect, it } from 'vitest'
import { canonicalizeFields, computeContentHash } from './consent-canonical'

describe('canonicalizeFields', () => {
  it('is order-stable and unambiguous (length-prefixed)', () => {
    expect(canonicalizeFields([['a', 'x'], ['b', null]])).toBe('a\x1f1:x\x1eb\x1f0:\x1e')
  })
})

describe('computeContentHash', () => {
  it('hashes the full disclosure (title, body, acceptanceLabel) deterministically', () => {
    const h1 = computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' })
    const h2 = computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' })
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentHash({ title: 'T', body: 'B2', acceptanceLabel: 'L' })).not.toBe(h1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run --filter @kuruma/shared test consent-canonical`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement canonicalization** (`packages/shared/src/lib/consent-canonical.ts`)

```typescript
import { createHash } from 'node:crypto'

const FIELD_SEP = '\x1e'
const KV_SEP = '\x1f'

/**
 * Deterministic, injection-proof serialization of an ordered field list.
 * Length-prefixing each value removes any delimiter ambiguity (spec §5).
 */
export function canonicalizeFields(fields: ReadonlyArray<readonly [string, string | null]>): string {
  return fields
    .map(([k, v]) => `${k}${KV_SEP}${v === null ? '0:' : `${byteLen(v)}:${v}`}${FIELD_SEP}`)
    .join('')
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

export interface DisclosureArtifact {
  title: string
  body: string
  acceptanceLabel: string
}

/** §5.1 — sha256 over the full disclosure a subject was shown. */
export function computeContentHash(d: DisclosureArtifact): string {
  const canonical = canonicalizeFields([
    ['title', d.title],
    ['body', d.body],
    ['acceptanceLabel', d.acceptanceLabel],
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run --filter @kuruma/shared test consent-canonical`
Expected: PASS.

- [ ] **Step 4a: Register the cross-package subpath export**

The API signer imports `@kuruma/shared/lib/consent-canonical`; the shared `exports` map has no wildcard, so add an explicit entry to `packages/shared/package.json` alongside the other `./lib/*` entries:

```json
"./lib/consent-canonical": "./src/lib/consent-canonical.ts"
```

- [ ] **Step 5: Write the signing test**

```typescript
// packages/api/src/services/consent-signing.test.ts
import { describe, expect, it } from 'vitest'
import { type SignableAcceptance, signAcceptanceRecord } from './consent-signing'

const PAYLOAD: SignableAcceptance = {
  documentId: 'doc_1',
  contentHash: 'a'.repeat(64),
  consentType: 'RENTER_TOS',
  version: '1.0',
  locale: 'en',
  userId: 'user_1',
  operatorId: null,
  operatorMembershipId: null,
  bookingId: null,
  method: 'CLICKWRAP',
  acceptedAt: new Date('2026-06-15T03:00:00.000Z'),
  ipAddress: '203.0.113.7',
  userAgent: 'jest',
}

describe('signAcceptanceRecord', () => {
  it('produces a stable hex HMAC + keyId for a given key', () => {
    const a = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' })
    const b = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' })
    expect(a.signature).toBe(b.signature)
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(a.signingKeyId).toBe('v1')
  })

  it('changes the signature when any signed field changes', () => {
    const base = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' }).signature
    expect(
      signAcceptanceRecord({ ...PAYLOAD, userId: 'user_2' }, { key: 'secret', keyId: 'v1' })
        .signature,
    ).not.toBe(base)
  })

  it('changes the signature when the key changes (rotation)', () => {
    const base = signAcceptanceRecord(PAYLOAD, { key: 'secret', keyId: 'v1' }).signature
    expect(
      signAcceptanceRecord(PAYLOAD, { key: 'secret2', keyId: 'v2' }).signature,
    ).not.toBe(base)
  })
})
```

- [ ] **Step 6: Run — expect FAIL**, then implement (`packages/api/src/services/consent-signing.ts`)

```typescript
import { createHmac } from 'node:crypto'
import { canonicalizeFields } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentMethod, ConsentType } from '@kuruma/shared/enums'

export interface SignableAcceptance {
  documentId: string
  contentHash: string
  consentType: ConsentType
  version: string
  locale: string
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  bookingId: string | null
  method: ConsentMethod
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

export interface SigningKey {
  key: string
  keyId: string
}

export interface AcceptanceSignature {
  signature: string
  signingKeyId: string
}

/** Tier-1: HMAC-SHA256 over the canonical signed-field set (spec §5). */
export function signAcceptanceRecord(
  p: SignableAcceptance,
  signingKey: SigningKey,
): AcceptanceSignature {
  const canonical = canonicalizeFields([
    ['documentId', p.documentId],
    ['contentHash', p.contentHash],
    ['consentType', p.consentType],
    ['version', p.version],
    ['locale', p.locale],
    ['userId', p.userId],
    ['operatorId', p.operatorId],
    ['operatorMembershipId', p.operatorMembershipId],
    ['bookingId', p.bookingId],
    ['method', p.method],
    ['acceptedAt', p.acceptedAt.toISOString()],
    ['ipAddress', p.ipAddress],
    ['userAgent', p.userAgent],
  ])
  const signature = createHmac('sha256', signingKey.key).update(canonical, 'utf8').digest('hex')
  return { signature, signingKeyId: signingKey.keyId }
}

/** Reads the CF secret. Returns undefined when unconfigured (caller decides: IMPORTED rows skip signing). */
export function resolveSigningKey(): SigningKey | undefined {
  const key = process.env.CONSENT_SIGNING_KEY
  if (!key) return undefined
  return { key, keyId: process.env.CONSENT_SIGNING_KEY_ID ?? 'v1' }
}
```

- [ ] **Step 7: Run both test files — expect PASS**

```bash
bun run --filter @kuruma/shared test consent-canonical
bun run --filter @kuruma/api test consent-signing
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/lib/consent-canonical.ts packages/shared/src/lib/consent-canonical.test.ts \
  packages/api/src/services/consent-signing.ts packages/api/src/services/consent-signing.test.ts
git commit -m "feat(consent): canonicalization + Tier-1 HMAC record signing (#877)"
```

> **HITL:** before deploy, `npx wrangler secret put CONSENT_SIGNING_KEY` on the API worker (a 32+ byte random value). Optionally `CONSENT_SIGNING_KEY_ID`. Add to the GitHub-Secrets source-of-truth + rotation workflow (mirror `AUTH_SECRET`).
>
> **Consistency nit (defer to Phase 2):** the repo resolves secrets at the composition root and injects them rather than reading `process.env` inside a service. `resolveSigningKey()` is the default arg only; when Phase 2 wires `ConsentService` into routes, resolve the key in `composition/` and pass it in.

---

## Task 5: Repository interface + `Repos` member

**Files:**
- Modify: `packages/api/src/repositories/types.ts`

- [ ] **Step 1: Add the interface** (near the other repo interfaces)

```typescript
import type { ConsentAcceptance, ConsentDocument } from '../stores'
import type { ConsentType } from '@kuruma/shared/enums'

export interface NewConsentAcceptance {
  documentId: string
  consentType: ConsentType
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  acceptedAt: Date
  context: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  method: ConsentAcceptance['method']
  recordSignature: string | null
  signingKeyId: string | null
}

export interface ConsentRepository {
  findDocumentById(id: string): Promise<ConsentDocument | undefined>
  /** Latest PUBLISHED+effective version string for a type, independent of locale (§7 cohort). */
  findLatestPublishedVersion(type: ConsentType, now: Date): Promise<string | undefined>
  /** Resolve the document row for a (type, version) in the subject's locale, else `en` fallback (Q4). */
  findPublishedDocument(
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined>
  /** Any accepted locale of this (type, version) by this user counts as current (§7). */
  hasAcceptedVersion(userId: string, type: ConsentType, version: string): Promise<boolean>
  /** Idempotency lookups — return the existing sealed row if present. */
  findUserDocumentAcceptance(
    userId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined>
  findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined>
  findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined>
  createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance>
}
```

- [ ] **Step 2: Add `consentRepo` to the `Repos` bundle type** (in `composition/repositories.ts`'s `Repos`)

```typescript
consentRepo: ConsentRepository
```
(Import `ConsentRepository` from `../repositories/types`.)

- [ ] **Step 3: Type-check (will fail at composition — wired in Task 8)** — acceptable red; commit after Task 8. For now:

Run: `bun run --filter @kuruma/api typecheck`
Expected: errors only in `composition/repositories.ts` — all three builders now miss `consentRepo` (wired in Task 8). Proceed to Tasks 6–8.

---

## Task 6: InMemory repository

**Files:**
- Create: `packages/api/src/repositories/in-memory/consent.ts`
- Test: `packages/api/src/repositories/in-memory/consent.test.ts`

- [ ] **Step 1: Write the test** (uniqueness seal + lookups)

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsentDocument } from '../../stores'
import { InMemoryConsentRepository } from './consent'

const DOC: ConsentDocument = {
  id: 'doc_tos_v1_en',
  type: 'RENTER_TOS',
  version: '1.0',
  locale: 'en',
  title: 'Terms',
  body: 'body',
  acceptanceLabel: 'I accept',
  contentHash: 'a'.repeat(64),
  status: 'PUBLISHED',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const baseAcceptance = {
  documentId: DOC.id,
  consentType: 'RENTER_TOS' as const,
  userId: 'user_1',
  operatorId: null,
  operatorMembershipId: null,
  actorRole: null,
  bookingId: null,
  acceptedAt: new Date('2026-06-15T00:00:00Z'),
  context: null,
  ipAddress: null,
  userAgent: null,
  method: 'CLICKWRAP' as const,
  recordSignature: 'sig',
  signingKeyId: 'v1',
}

describe('InMemoryConsentRepository', () => {
  let repo: InMemoryConsentRepository
  beforeEach(() => {
    repo = new InMemoryConsentRepository([DOC])
  })

  it('finds the latest published version and resolves a locale doc', async () => {
    expect(await repo.findLatestPublishedVersion('RENTER_TOS', new Date('2026-06-15Z'))).toBe('1.0')
    expect((await repo.findPublishedDocument('RENTER_TOS', '1.0', 'en'))?.id).toBe(DOC.id)
  })

  it('records an acceptance and reports the version accepted', async () => {
    await repo.createAcceptance(baseAcceptance)
    expect(await repo.hasAcceptedVersion('user_1', 'RENTER_TOS', '1.0')).toBe(true)
    expect(await repo.hasAcceptedVersion('user_2', 'RENTER_TOS', '1.0')).toBe(false)
  })

  it('seals once-per-user idempotency with a PG-shaped 23505', async () => {
    await repo.createAcceptance(baseAcceptance)
    await expect(repo.createAcceptance(baseAcceptance)).rejects.toMatchObject({ code: '23505' })
    expect((await repo.findUserDocumentAcceptance('user_1', DOC.id))?.userId).toBe('user_1')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then implement (`in-memory/consent.ts`)

```typescript
import { PG_ERROR } from '../../pg-errors'
import type { ConsentType } from '@kuruma/shared/enums'
import type { ConsentAcceptance, ConsentDocument } from '../../stores'
import type { ConsentRepository, NewConsentAcceptance } from '../types'

// Mirror postgres-js's PostgresError shape (top-level `code` + `constraint_name`) so the
// service's 23505 catch-path behaves identically against the in-memory and Drizzle repos.
// Same pattern as repositories/in-memory/booking.ts.
function uniqueViolation(constraintName: string): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

export class InMemoryConsentRepository implements ConsentRepository {
  private readonly docs: Map<string, ConsentDocument>
  private readonly acceptances: ConsentAcceptance[] = []

  constructor(documents: ConsentDocument[] = []) {
    this.docs = new Map(documents.map((d) => [d.id, d]))
  }

  async findDocumentById(id: string): Promise<ConsentDocument | undefined> {
    return this.docs.get(id)
  }

  async findLatestPublishedVersion(type: ConsentType, now: Date): Promise<string | undefined> {
    const versions = [...this.docs.values()]
      .filter((d) => d.type === type && d.status === 'PUBLISHED' && d.effectiveFrom <= now)
      .map((d) => d.version)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return versions.at(-1)
  }

  async findPublishedDocument(
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined> {
    return [...this.docs.values()].find(
      (d) =>
        d.type === type && d.version === version && d.locale === locale && d.status === 'PUBLISHED',
    )
  }

  async hasAcceptedVersion(userId: string, type: ConsentType, version: string): Promise<boolean> {
    const ids = new Set(
      [...this.docs.values()].filter((d) => d.type === type && d.version === version).map((d) => d.id),
    )
    return this.acceptances.some((a) => a.userId === userId && ids.has(a.documentId))
  }

  async findUserDocumentAcceptance(
    userId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find(
      (a) =>
        a.userId === userId &&
        a.documentId === documentId &&
        a.bookingId === null &&
        a.operatorId === null,
    )
  }

  async findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find((a) => a.bookingId === bookingId)
  }

  async findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find((a) => a.operatorId === operatorId && a.documentId === documentId)
  }

  async createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance> {
    this.assertUnique(data)
    const row: ConsentAcceptance = {
      ...data,
      id: crypto.randomUUID(),
      signatureRef: null,
      createdAt: new Date(),
    }
    this.acceptances.push(row)
    return row
  }

  private assertUnique(d: NewConsentAcceptance): void {
    if (d.bookingId !== null) {
      if (this.acceptances.some((a) => a.bookingId === d.bookingId))
        throw uniqueViolation('consent_unique_booking_liability')
      return
    }
    if (d.operatorId !== null) {
      if (
        this.acceptances.some((a) => a.operatorId === d.operatorId && a.documentId === d.documentId)
      )
        throw uniqueViolation('consent_unique_operator_document')
      return
    }
    if (
      this.acceptances.some(
        (a) =>
          a.userId === d.userId &&
          a.documentId === d.documentId &&
          a.bookingId === null &&
          a.operatorId === null,
      )
    )
      throw uniqueViolation('consent_unique_user_document')
  }
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `bun run --filter @kuruma/api test in-memory/consent`

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/repositories/types.ts packages/api/src/repositories/in-memory/consent.ts \
  packages/api/src/repositories/in-memory/consent.test.ts
git commit -m "feat(consent): ConsentRepository interface + InMemory impl (#877)"
```

---

## Task 7: Drizzle repository + mappers

**Files:**
- Create: `packages/api/src/repositories/drizzle/consent.ts`

- [ ] **Step 1: Implement** (mappers local to the file; mirror `drizzle/add-on.ts`)

```typescript
import { consentAcceptances, consentDocuments } from '@kuruma/shared/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ConsentType } from '@kuruma/shared/enums'
import type { ConsentAcceptance, ConsentDocument } from '../../stores'
import type { ConsentRepository, NewConsentAcceptance } from '../types'
import type { Db } from './shared'

type DocRow = typeof consentDocuments.$inferSelect
type AcceptanceRow = typeof consentAcceptances.$inferSelect

// Explicit field-by-field (house convention — repositories/drizzle/shared.ts:283): adding a
// field to the domain type without a backing column fails to compile, unlike a `{ ...r }`
// spread or `as` cast which silently drift.
function toDocument(r: DocRow): ConsentDocument {
  return {
    id: r.id,
    type: r.type,
    version: r.version,
    locale: r.locale,
    title: r.title,
    body: r.body,
    acceptanceLabel: r.acceptanceLabel,
    contentHash: r.contentHash,
    status: r.status,
    effectiveFrom: r.effectiveFrom,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
function toAcceptance(r: AcceptanceRow): ConsentAcceptance {
  return {
    id: r.id,
    documentId: r.documentId,
    consentType: r.consentType,
    userId: r.userId,
    operatorId: r.operatorId,
    operatorMembershipId: r.operatorMembershipId,
    actorRole: r.actorRole,
    bookingId: r.bookingId,
    acceptedAt: r.acceptedAt,
    context: r.context,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    method: r.method,
    recordSignature: r.recordSignature,
    signingKeyId: r.signingKeyId,
    signatureRef: r.signatureRef,
    createdAt: r.createdAt,
  }
}

export class DrizzleConsentRepository implements ConsentRepository {
  constructor(private readonly db: Db) {}

  async findDocumentById(id: string): Promise<ConsentDocument | undefined> {
    const [row] = await this.db
      .select()
      .from(consentDocuments)
      .where(eq(consentDocuments.id, id))
      .limit(1)
    return row ? toDocument(row) : undefined
  }

  async findLatestPublishedVersion(type: ConsentType, now: Date): Promise<string | undefined> {
    const rows = await this.db
      .select({ version: consentDocuments.version, effectiveFrom: consentDocuments.effectiveFrom })
      .from(consentDocuments)
      .where(and(eq(consentDocuments.type, type), eq(consentDocuments.status, 'PUBLISHED')))
    const eligible = rows
      .filter((r) => r.effectiveFrom <= now)
      .map((r) => r.version)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return eligible.at(-1)
  }

  async findPublishedDocument(
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined> {
    const [row] = await this.db
      .select()
      .from(consentDocuments)
      .where(
        and(
          eq(consentDocuments.type, type),
          eq(consentDocuments.version, version),
          eq(consentDocuments.locale, locale),
          eq(consentDocuments.status, 'PUBLISHED'),
        ),
      )
      .limit(1)
    return row ? toDocument(row) : undefined
  }

  async hasAcceptedVersion(userId: string, type: ConsentType, version: string): Promise<boolean> {
    const docIds = (
      await this.db
        .select({ id: consentDocuments.id })
        .from(consentDocuments)
        .where(and(eq(consentDocuments.type, type), eq(consentDocuments.version, version)))
    ).map((r) => r.id)
    if (docIds.length === 0) return false
    const [row] = await this.db
      .select({ id: consentAcceptances.id })
      .from(consentAcceptances)
      .where(
        and(
          eq(consentAcceptances.userId, userId),
          inArray(consentAcceptances.documentId, docIds),
        ),
      )
      .limit(1)
    return row !== undefined
  }

  async findUserDocumentAcceptance(
    userId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    const [row] = await this.db
      .select()
      .from(consentAcceptances)
      .where(
        and(
          eq(consentAcceptances.userId, userId),
          eq(consentAcceptances.documentId, documentId),
          isNull(consentAcceptances.bookingId),
          isNull(consentAcceptances.operatorId),
        ),
      )
      .limit(1)
    return row ? toAcceptance(row) : undefined
  }

  async findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined> {
    const [row] = await this.db
      .select()
      .from(consentAcceptances)
      .where(eq(consentAcceptances.bookingId, bookingId))
      .limit(1)
    return row ? toAcceptance(row) : undefined
  }

  async findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    const [row] = await this.db
      .select()
      .from(consentAcceptances)
      .where(
        and(
          eq(consentAcceptances.operatorId, operatorId),
          eq(consentAcceptances.documentId, documentId),
        ),
      )
      .limit(1)
    return row ? toAcceptance(row) : undefined
  }

  async createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance> {
    const [row] = await this.db
      .insert(consentAcceptances)
      .values({ id: crypto.randomUUID(), ...data })
      .returning()
    if (!row) throw new Error('Failed to insert consent acceptance')
    return toAcceptance(row)
  }
}
```

> **Note:** `createAcceptance` lets a Postgres `23505` propagate; the service (Task 9) catches it and re-fetches. Confirm `Db` is exported from `./shared` (it is: `repositories/drizzle/shared.ts:38`).

- [ ] **Step 2: Type-check** — `bun run --filter @kuruma/api typecheck` (still red only at composition until Task 8).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/repositories/drizzle/consent.ts
git commit -m "feat(consent): Drizzle ConsentRepository (#877)"
```

---

## Task 8: DI wiring (composition root)

**Files:**
- Modify: `packages/api/src/composition/repositories.ts`

- [ ] **Step 1: Construct in `buildDrizzleRepos`** — add to the returned bundle:

```typescript
consentRepo: new DrizzleConsentRepository(db),
```
(Import `DrizzleConsentRepository` from `../repositories/drizzle/consent`.)

- [ ] **Step 2: Construct in `buildInMemoryRepos`** — add:

```typescript
consentRepo: new InMemoryConsentRepository(),
```
(Import `InMemoryConsentRepository` from `../repositories/in-memory/consent`.)

- [ ] **Step 2b: Construct in `buildOverrideRepos`** — `Repos` now requires `consentRepo`, so the THIRD builder (the one the route/integration suite uses) must supply it too. Add a bare default alongside the other `const xRepo = …` lines and include `consentRepo` in the returned bundle:

```typescript
const consentRepo = new InMemoryConsentRepository()
```

> Do **not** add `consentRepo` to the in-transaction sub-bundle yet — Phase 4 adds it when the liability acceptance joins `submitInTx`. No `AppOverrides.consentRepo?` field is needed in Phase 1 (no route test injects a seeded one); add it in Phase 2 if required.

- [ ] **Step 3: Type-check + boundary lint — now fully green**

```bash
bun run --filter @kuruma/api typecheck
bun run --filter @kuruma/api lint:boundaries
```
Expected: PASS (all three builders supply `consentRepo`; concrete repos constructed only in composition).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/composition/repositories.ts
git commit -m "feat(consent): wire ConsentRepository into composition root (#877)"
```

---

## Task 9: `ConsentService`

Handles: idempotent `recordAcceptance` (validates the document is PUBLISHED+effective, enforces subject-shape pre-check, signs CLICKWRAP/ESIGN rows, collapses retries onto the sealed row) and the cohort-first re-consent query.

**Files:**
- Create: `packages/api/src/services/consent.ts`
- Test: `packages/api/src/services/consent.test.ts`

- [ ] **Step 1: Write the test** (use InMemory repo + a fixed signing key)

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsentDocument } from '../stores'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import { ConsentService } from './consent'

const KEY = { key: 'test-secret', keyId: 'v1' }
function doc(over: Partial<ConsentDocument> = {}): ConsentDocument {
  return {
    id: 'doc_tos_v1_en',
    type: 'RENTER_TOS',
    version: '1.0',
    locale: 'en',
    title: 'Terms',
    body: 'body',
    acceptanceLabel: 'I accept',
    contentHash: 'a'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}
const NOW = new Date('2026-06-15T00:00:00Z')

describe('ConsentService.recordAcceptance', () => {
  let repo: InMemoryConsentRepository
  let svc: ConsentService
  beforeEach(() => {
    repo = new InMemoryConsentRepository([doc()])
    svc = new ConsentService(repo, () => KEY)
  })

  it('signs and persists a renter ToS acceptance', async () => {
    const r = await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW, ipAddress: '203.0.113.7', userAgent: 'jest' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.acceptance.consentType).toBe('RENTER_TOS')
    expect(r.acceptance.recordSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(r.acceptance.signingKeyId).toBe('v1')
    expect(r.acceptance.acceptedAt).toEqual(NOW)
  })

  it('rejects a DRAFT document with NOT_ACCEPTABLE', async () => {
    repo = new InMemoryConsentRepository([doc({ status: 'DRAFT' })])
    svc = new ConsentService(repo, () => KEY)
    const r = await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 409, error: 'DOCUMENT_NOT_ACCEPTABLE' })
  })

  it('rejects an unknown document with 404', async () => {
    const r = await svc.recordAcceptance(
      { documentId: 'nope', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('is idempotent — a retry returns the existing row, not a duplicate', async () => {
    const input = { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' as const }
    const first = await svc.recordAcceptance(input, { now: NOW })
    const second = await svc.recordAcceptance(input, { now: new Date('2026-06-16Z') })
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.acceptance.id).toBe(first.acceptance.id)
  })
})

describe('ConsentService re-consent query (renter)', () => {
  it('reports missing types and flips to current after acceptance', async () => {
    const repo = new InMemoryConsentRepository([
      doc(),
      doc({ id: 'doc_priv_v1_en', type: 'PRIVACY_POLICY', title: 'Privacy' }),
    ])
    const svc = new ConsentService(repo, () => KEY)
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
    ])
    await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    await svc.recordAcceptance(
      { documentId: 'doc_priv_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual([])
    expect(await svc.isCurrent('user_1', 'RENTER', NOW)).toBe(true)
  })

  it('flags non-current the moment a newer version publishes in ANY single locale (§7 cohort-first)', async () => {
    const repo = new InMemoryConsentRepository([
      doc(), // RENTER_TOS 1.0 en
      doc({ id: 'doc_tos_v2_ja', version: '2.0', locale: 'ja' }), // newest cohort, ja-only
    ])
    const svc = new ConsentService(repo, () => KEY)
    await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    // accepted 1.0 only; latest TOS cohort is now 2.0 (ja) → still required. PRIVACY unpublished → skipped.
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual(['RENTER_TOS'])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then implement (`packages/api/src/services/consent.ts`)

```typescript
import { CONSENT_CARDINALITY, type ConsentType } from '@kuruma/shared/enums'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { ConsentAcceptance } from '../stores'
import type { ConsentRepository, NewConsentAcceptance } from '../repositories/types'
import {
  type SigningKey,
  resolveSigningKey,
  signAcceptanceRecord,
} from './consent-signing'

/** Required once-per-subject document types by role (operator types arrive in Phase 3). */
const REQUIRED_TYPES: Record<string, ConsentType[]> = {
  RENTER: ['RENTER_TOS', 'PRIVACY_POLICY'],
}

export interface RecordAcceptanceInput {
  documentId: string
  userId: string
  actorRole: string | null
  operatorId?: string | null
  operatorMembershipId?: string | null
  bookingId?: string | null
}
export interface RecordAcceptanceMeta {
  now: Date
  ipAddress?: string | null
  userAgent?: string | null
}
export type RecordAcceptanceResult =
  | { ok: true; acceptance: ConsentAcceptance }
  | { ok: false; status: number; error: string }

export class ConsentService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly getSigningKey: () => SigningKey | undefined = resolveSigningKey,
  ) {}

  async recordAcceptance(
    input: RecordAcceptanceInput,
    meta: RecordAcceptanceMeta,
  ): Promise<RecordAcceptanceResult> {
    const doc = await this.repo.findDocumentById(input.documentId)
    if (!doc) return { ok: false, status: 404, error: 'DOCUMENT_NOT_FOUND' }
    if (doc.status !== 'PUBLISHED' || doc.effectiveFrom > meta.now)
      return { ok: false, status: 409, error: 'DOCUMENT_NOT_ACCEPTABLE' }

    const bookingId = input.bookingId ?? null
    const operatorId = input.operatorId ?? null
    // Subject-shape pre-check (the DB CHECKs are the real seal; this returns a clean 400).
    const isLiability = doc.type === 'RENTER_LIABILITY'
    const isOperator = doc.type === 'OPERATOR_AGREEMENT'
    if (isLiability !== (bookingId !== null) || isOperator !== (operatorId !== null))
      return { ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' }

    const existing = await this.findExisting(doc.type, input.userId, doc.id, operatorId, bookingId)
    if (existing) return { ok: true, acceptance: existing }

    const data = this.buildRow(doc, input, meta, operatorId, bookingId)
    try {
      return { ok: true, acceptance: await this.repo.createAcceptance(data) }
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const row = await this.findExisting(doc.type, input.userId, doc.id, operatorId, bookingId)
        if (row) return { ok: true, acceptance: row }
      }
      throw err
    }
  }

  async getRequiredReconsents(userId: string, role: string, now: Date): Promise<ConsentType[]> {
    const required = REQUIRED_TYPES[role] ?? []
    const missing: ConsentType[] = []
    for (const type of required) {
      if (CONSENT_CARDINALITY[type] !== 'ONCE_PER_SUBJECT') continue
      const version = await this.repo.findLatestPublishedVersion(type, now)
      if (!version) continue // nothing published yet → cannot block
      if (!(await this.repo.hasAcceptedVersion(userId, type, version))) missing.push(type)
    }
    return missing
  }

  async isCurrent(userId: string, role: string, now: Date): Promise<boolean> {
    return (await this.getRequiredReconsents(userId, role, now)).length === 0
  }

  private buildRow(
    doc: { id: string; type: ConsentType; version: string; locale: string; contentHash: string },
    input: RecordAcceptanceInput,
    meta: RecordAcceptanceMeta,
    operatorId: string | null,
    bookingId: string | null,
  ): NewConsentAcceptance {
    const acceptedAt = meta.now
    const ipAddress = meta.ipAddress ?? null
    const userAgent = meta.userAgent ?? null
    // actorRole + context are intentionally OUTSIDE the signed envelope (§5 field list):
    // actorRole is a mutable-status snapshot for post-anonymization context (§4.4); context is
    // supplemental metadata — neither is tamper-evidence.
    const key = this.getSigningKey()
    const signed = key
      ? signAcceptanceRecord(
          {
            documentId: doc.id,
            contentHash: doc.contentHash,
            consentType: doc.type,
            version: doc.version,
            locale: doc.locale,
            userId: input.userId,
            operatorId,
            operatorMembershipId: input.operatorMembershipId ?? null,
            bookingId,
            method: 'CLICKWRAP',
            acceptedAt,
            ipAddress,
            userAgent,
          },
          key,
        )
      : undefined
    return {
      documentId: doc.id,
      consentType: doc.type,
      userId: input.userId,
      operatorId,
      operatorMembershipId: input.operatorMembershipId ?? null,
      actorRole: input.actorRole,
      bookingId,
      acceptedAt,
      context: null,
      ipAddress,
      userAgent,
      method: 'CLICKWRAP',
      recordSignature: signed?.signature ?? null,
      signingKeyId: signed?.signingKeyId ?? null,
    }
  }

  private findExisting(
    type: ConsentType,
    userId: string,
    documentId: string,
    operatorId: string | null,
    bookingId: string | null,
  ): Promise<ConsentAcceptance | undefined> {
    if (bookingId !== null) return this.repo.findBookingAcceptance(bookingId)
    if (operatorId !== null) return this.repo.findOperatorDocumentAcceptance(operatorId, documentId)
    return this.repo.findUserDocumentAcceptance(userId, documentId)
  }

  private isUniqueViolation(err: unknown): boolean {
    // postgres-js/neon nest the code under err.cause; the in-memory repo throws a
    // PG-shaped error with a top-level code. pgErrorCode handles both.
    return pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION
  }
}
```

> **DIP note:** `getSigningKey` is injected (default `resolveSigningKey`) so tests don't need `process.env`. The service depends on the `ConsentRepository` *interface*, never a concrete repo.

- [ ] **Step 3: Run — expect PASS**

Run: `bun run --filter @kuruma/api test services/consent.test`

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/consent.ts packages/api/src/services/consent.test.ts
git commit -m "feat(consent): ConsentService — idempotent signed accept + re-consent query (#877)"
```

---

## Task 10: `ConsentGateService` (pure policy)

The policy decision the Phase 2 middleware will call. No Hono, no req/res here.

**Files:**
- Create: `packages/api/src/services/consent-gate.ts`
- Test: `packages/api/src/services/consent-gate.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from 'vitest'
import { ConsentGateService } from './consent-gate'

function svc(missing: string[]) {
  return new ConsentGateService({
    getRequiredReconsents: async () => missing as never,
  } as never)
}
const NOW = new Date('2026-06-15Z')

describe('ConsentGateService.assertSubjectCurrent', () => {
  it('allows a current subject', async () => {
    expect(await svc([]).assertSubjectCurrent('user_1', 'RENTER', NOW)).toEqual({ allowed: true })
  })

  it('denies with CONSENT_REQUIRED + the missing types', async () => {
    expect(await svc(['RENTER_TOS']).assertSubjectCurrent('user_1', 'RENTER', NOW)).toEqual({
      allowed: false,
      code: 'CONSENT_REQUIRED',
      status: 403,
      missing: ['RENTER_TOS'],
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then implement (`consent-gate.ts`)

```typescript
import type { ConsentType } from '@kuruma/shared/enums'

/** The slice of ConsentService the gate needs (ISP — depend on the narrow shape). */
export interface ReconsentQuery {
  getRequiredReconsents(userId: string, role: string, now: Date): Promise<ConsentType[]>
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; code: 'CONSENT_REQUIRED'; status: 403; missing: ConsentType[] }

export class ConsentGateService {
  constructor(private readonly consent: ReconsentQuery) {}

  async assertSubjectCurrent(userId: string, role: string, now: Date): Promise<GateDecision> {
    const missing = await this.consent.getRequiredReconsents(userId, role, now)
    if (missing.length === 0) return { allowed: true }
    return { allowed: false, code: 'CONSENT_REQUIRED', status: 403, missing }
  }
}
```

> **ISP note:** the gate takes a narrow `ReconsentQuery` (one method), not the whole `ConsentService` — so Phase 2's middleware test mocks one function, not a class.

- [ ] **Step 3: Run — expect PASS**, then commit

```bash
bun run --filter @kuruma/api test services/consent-gate.test
git add packages/api/src/services/consent-gate.ts packages/api/src/services/consent-gate.test.ts
git commit -m "feat(consent): ConsentGateService policy decision (#877)"
```

---

## Task 11: Seed the four documents (en/ja/zh)

**Files:**
- Create: `packages/shared/src/db/seed-data/consent-documents.ts`
- Modify: `packages/shared/src/db/seed-data/index.ts`, `packages/shared/src/db/seed.ts`
- Test: `packages/shared/src/db/seed-data/consent-documents.test.ts`

- [ ] **Step 1: Write the seed-data test** (count, hash integrity, liability text matches i18n)

```typescript
import { describe, expect, it } from 'vitest'
import { computeContentHash } from '../../lib/consent-canonical'
import { DEMO_CONSENT_DOCUMENTS } from './consent-documents'

describe('DEMO_CONSENT_DOCUMENTS', () => {
  it('has 4 types × 3 locales = 12 PUBLISHED rows', () => {
    expect(DEMO_CONSENT_DOCUMENTS).toHaveLength(12)
    expect(DEMO_CONSENT_DOCUMENTS.every((d) => d.status === 'PUBLISHED')).toBe(true)
  })

  it('stores a contentHash consistent with its disclosure (title, body, acceptanceLabel)', () => {
    for (const d of DEMO_CONSENT_DOCUMENTS) {
      expect(d.contentHash).toBe(
        computeContentHash({ title: d.title, body: d.body, acceptanceLabel: d.acceptanceLabel }),
      )
    }
  })

  it('keeps the RENTER_LIABILITY body verbatim from the booking i18n (Phase 4 backfill parity)', () => {
    const en = DEMO_CONSENT_DOCUMENTS.find(
      (d) => d.type === 'RENTER_LIABILITY' && d.locale === 'en',
    )
    expect(en?.version).toBe('2026-06-13')
    expect(en?.body).toContain('verification is completed in person at pickup')
  })

  it('seeds documents that are PUBLISHED and effective as of the seed date (service-acceptable)', () => {
    const asOf = new Date('2026-06-15T00:00:00Z')
    for (const d of DEMO_CONSENT_DOCUMENTS) {
      expect(d.status).toBe('PUBLISHED')
      expect(d.effectiveFrom.getTime()).toBeLessThanOrEqual(asOf.getTime())
    }
  })
})
```

- [ ] **Step 2: Run — expect FAIL**, then write the seed data (`consent-documents.ts`)

```typescript
// MVP legal copy. RENTER_LIABILITY text is the exact current booking i18n (so the Phase 4
// IMPORTED backfill matches byte-for-byte). RENTER_TOS / PRIVACY_POLICY / OPERATOR_AGREEMENT
// bodies are concise MVP copy — REPLACE with counsel-reviewed text before production.
import { computeContentHash } from '../../lib/consent-canonical'
import type { ConsentDocStatus, ConsentMethod, ConsentType } from '../../enums'

export interface DemoConsentDocument {
  id: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
  status: ConsentDocStatus
  effectiveFrom: Date
}

const EFFECTIVE_FROM = new Date('2026-06-13T00:00:00Z')

interface Copy {
  version: string
  locales: Record<'en' | 'ja' | 'zh', { title: string; body: string; acceptanceLabel: string }>
}

const COPY: Record<ConsentType, Copy> = {
  RENTER_LIABILITY: {
    version: '2026-06-13',
    locales: {
      en: {
        title: 'Rental Liability Disclaimer',
        body: 'License and International Driving Permit verification is completed in person at pickup, not online. By reserving, you confirm you hold the required documents and accept full responsibility for the vehicle during your rental.',
        acceptanceLabel:
          "I agree to present a valid driver's license and International Driving Permit at pickup, and I accept the rental liability terms.",
      },
      ja: {
        title: 'レンタル責任に関する免責事項',
        body: '運転免許証と国際運転免許証の確認は、オンラインではなく受け取り時に対面で行います。ご予約により、必要書類を所持していることを確認し、レンタル期間中の車両に対する全責任を負うことに同意したものとみなされます。',
        acceptanceLabel:
          '受け取り時に有効な運転免許証および国際運転免許証を提示し、レンタルの責任条件に同意します。',
      },
      zh: {
        title: '租赁责任免责声明',
        body: '驾驶证和国际驾驶许可证的核验将在取车时当面完成，而非在线办理。预订即表示您确认持有所需证件，并同意在租赁期间对车辆承担全部责任。',
        acceptanceLabel: '我同意在取车时出示有效驾驶证和国际驾驶许可证，并接受租赁责任条款。',
      },
    },
  },
  RENTER_TOS: {
    version: '1.0',
    locales: {
      en: {
        title: 'Terms of Service',
        body: 'These Terms govern your use of the Kuruma car-rental marketplace. You agree to provide accurate booking information, follow each operator’s pickup and return rules, and use reserved vehicles lawfully. Bookings are instant-confirmed; cancellation fees apply on a tiered schedule disclosed at checkout.',
        acceptanceLabel: 'I have read and accept the Terms of Service.',
      },
      ja: {
        title: '利用規約',
        body: '本規約は、Kuruma カーレンタル・マーケットプレイスのご利用に適用されます。お客様は、正確な予約情報の提供、各事業者の受け渡しおよび返却規則の遵守、ならびに予約車両の適法な利用に同意するものとします。予約は即時確定され、キャンセル料は予約時に提示される段階的な料金体系に従います。',
        acceptanceLabel: '利用規約を読み、同意します。',
      },
      zh: {
        title: '服务条款',
        body: '本条款适用于您对 Kuruma 汽车租赁平台的使用。您同意提供准确的预订信息，遵守各运营商的取车与还车规则，并合法使用所预订的车辆。预订即时确认，取消费用按结账时披露的分级标准收取。',
        acceptanceLabel: '我已阅读并接受服务条款。',
      },
    },
  },
  PRIVACY_POLICY: {
    version: '1.0',
    locales: {
      en: {
        title: 'Privacy Policy',
        body: 'We collect the booking, contact, and identity-verification data needed to provide rentals, and share it with the operator fulfilling your booking. We retain consent and transaction records as legally required and never sell your personal data.',
        acceptanceLabel: 'I have read and accept the Privacy Policy.',
      },
      ja: {
        title: 'プライバシーポリシー',
        body: '当社は、レンタルの提供に必要な予約・連絡先・本人確認の情報を取得し、ご予約を履行する事業者と共有します。同意および取引の記録は法令で要求される期間保持し、お客様の個人データを販売することはありません。',
        acceptanceLabel: 'プライバシーポリシーを読み、同意します。',
      },
      zh: {
        title: '隐私政策',
        body: '我们收集提供租赁服务所需的预订、联系方式及身份核验信息，并与履行您预订的运营商共享。我们将按法律要求保留同意与交易记录，绝不出售您的个人数据。',
        acceptanceLabel: '我已阅读并接受隐私政策。',
      },
    },
  },
  OPERATOR_AGREEMENT: {
    version: '1.0',
    locales: {
      en: {
        title: 'Operator Platform Agreement',
        body: 'As an operator you agree to list accurate vehicle and pricing information, honor instant-confirmed bookings, complete identity verification at pickup, and pay the platform commission disclosed in your operator console. You are responsible for your fleet’s insurance and roadworthiness.',
        acceptanceLabel: 'I am authorized to bind this operator and accept the Operator Platform Agreement.',
      },
      ja: {
        title: '事業者プラットフォーム規約',
        body: '事業者として、お客様は正確な車両および料金情報の掲載、即時確定予約の履行、受け渡し時の本人確認の実施、ならびに事業者コンソールに表示されるプラットフォーム手数料の支払いに同意します。車両の保険および整備状態については事業者が責任を負います。',
        acceptanceLabel: '私はこの事業者を代表する権限を有し、事業者プラットフォーム規約に同意します。',
      },
      zh: {
        title: '运营商平台协议',
        body: '作为运营商，您同意发布准确的车辆与价格信息、履行即时确认的预订、在取车时完成身份核验，并支付运营商控制台所披露的平台佣金。车队的保险与适驾状态由运营商负责。',
        acceptanceLabel: '我已获授权代表该运营商，并接受运营商平台协议。',
      },
    },
  },
}

function buildDocs(): readonly DemoConsentDocument[] {
  const rows: DemoConsentDocument[] = []
  for (const type of Object.keys(COPY) as ConsentType[]) {
    const { version, locales } = COPY[type]
    for (const locale of ['en', 'ja', 'zh'] as const) {
      const c = locales[locale]
      rows.push({
        id: `consent_${type.toLowerCase()}_${version.replace(/\./g, '_')}_${locale}`,
        type,
        version,
        locale,
        title: c.title,
        body: c.body,
        acceptanceLabel: c.acceptanceLabel,
        contentHash: computeContentHash(c),
        status: 'PUBLISHED',
        effectiveFrom: EFFECTIVE_FROM,
      })
    }
  }
  return rows
}

export const DEMO_CONSENT_DOCUMENTS: readonly DemoConsentDocument[] = buildDocs()
export const CONSENT_ACCEPTANCE_DEFAULT_METHOD: ConsentMethod = 'CLICKWRAP'
```

- [ ] **Step 3: Re-export** — add to `seed-data/index.ts`:

```typescript
export * from './consent-documents'
```

- [ ] **Step 4: Add the seeder loop** in `seed.ts` (idempotent upsert; mirror the regions/insurance loops)

```typescript
// imports at top
import { consentDocuments } from './schema'
import { DEMO_CONSENT_DOCUMENTS } from './seed-data/consent-documents'

// inside seed(), after the existing fixtures:
for (const d of DEMO_CONSENT_DOCUMENTS) {
  await db
    .insert(consentDocuments)
    .values({
      id: d.id,
      type: d.type,
      version: d.version,
      locale: d.locale,
      title: d.title,
      body: d.body,
      acceptanceLabel: d.acceptanceLabel,
      contentHash: d.contentHash,
      status: d.status,
      effectiveFrom: d.effectiveFrom,
      publishedAt: now,
    })
    .onConflictDoUpdate({
      target: consentDocuments.id,
      set: {
        title: d.title,
        body: d.body,
        acceptanceLabel: d.acceptanceLabel,
        contentHash: d.contentHash,
        status: d.status,
        effectiveFrom: d.effectiveFrom,
        publishedAt: now,
        updatedAt: now,
      },
    })
}
```
(`now` is the existing `const now = new Date()` in `seed()`; confirm and reuse it.)

- [ ] **Step 5: Run the seed-data test + seed against a local DB**

```bash
bun run --filter @kuruma/shared test consent-documents
bun run db:seed          # requires DATABASE_URL; should insert/upsert 12 rows idempotently
bun run db:seed          # second run is a no-op upsert (idempotency check)
```
Expected: tests PASS; both seed runs succeed with no constraint errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/db/seed-data/consent-documents.ts \
  packages/shared/src/db/seed-data/consent-documents.test.ts \
  packages/shared/src/db/seed-data/index.ts packages/shared/src/db/seed.ts
git commit -m "feat(consent): seed RENTER_TOS/PRIVACY/LIABILITY/OPERATOR documents en/ja/zh (#877)"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run every gate**

```bash
bun run --filter @kuruma/shared test
bun run --filter @kuruma/api test
bun run --filter @kuruma/shared typecheck
bun run --filter @kuruma/api typecheck
bun run --filter @kuruma/api lint:boundaries
bun run lint:fk-indexes
bun run db:verify
bun run lint            # biome (whole repo)
```
Expected: all PASS / green.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/consent-ledger
gh pr create --base marketplace-pivot --title "feat(consent): consent ledger Phase 1 — schema, repos, services, signing, seed (#877)" \
  --body "Implements Phase 1 of the consent-ledger design (docs/superpowers/specs/2026-06-15-consent-ledger-design.md). Schema + enums + repositories + ConsentService/ConsentGateService + Tier-1 HMAC signing + seed (4 types × en/ja/zh). No routes/middleware (Phase 2+). Refs #877.

HITL before deploy: set CONSENT_SIGNING_KEY (+ optional CONSENT_SIGNING_KEY_ID) on the API worker. Signing primitive = HMAC-SHA256 (seam allows Ed25519 upgrade). ToS/privacy/operator seed bodies are MVP copy pending counsel review."
```

---

## Self-review (run before requesting code review)

**1. Spec coverage:** §4 schema (Task 2) · §4.1 sync seal + CHECKs + 3 uniques + FK-covering indexes (Task 2) · §4.2 cardinality map (Task 1) · §4.4 ON DELETE RESTRICT (Task 2) · §5/§5.1 Tier-1 signing + contentHash (Tasks 4, 9) · §6A accept-self/published-only authz + idempotency (Task 9) · §7 cohort-first re-consent (Task 9) · §9.2 Tier-1 in Phase 1 (Task 4) · §9.3 seed authoring (Task 11) · §9.4 `en` fallback (`findPublishedDocument` resolves locale; Phase 2 wires the fallback at the gate — note in Phase 2 plan) · §10 Phase-1 scope. **Deferred-by-design:** §4.3 DB triggers, §6A/B route+web gate, §6B operator-bindability, §6C booking migration/backfill, §8 Tier-2.

**2. Placeholder scan:** none — every code step is concrete. The only "replace before production" marker is the MVP legal copy (intentional, flagged), not a code placeholder.

**3. Type consistency:** `ConsentRepository`, `NewConsentAcceptance`, `recordAcceptance`, `getRequiredReconsents`, `isCurrent`, `assertSubjectCurrent`, `signAcceptanceRecord`, `computeContentHash`, `canonicalizeFields`, `ConsentDocument`/`ConsentAcceptance`, `CONSENT_CARDINALITY` are used identically across Tasks 1–11. The InMemory repo throws a PG-shaped `23505` (local `uniqueViolation` helper); the service detects it via `pgErrorCode()` — one detector for both the in-memory and Drizzle paths.

**Post-review fixes folded in (2026-06-15, two adversarial reviewers):** PG-error detection via `pgErrorCode()` not bare `.code` (in-memory repo throws a PG-shaped 23505) [P1] · `consentRepo` wired into all THREE composition builders incl. `buildOverrideRepos` [P1] · `@kuruma/shared/lib/consent-canonical` exports subpath registered [blocker] · `operatorMemberships` imported from `db/provider-access` · typecheck command is `typecheck` · seed imports tables from the `./schema` barrel · Drizzle `findUserDocumentAcceptance` includes the `isNull(bookingId/operatorId)` partial-index predicate [P2] · explicit field-by-field row mappers, no `{...r}` spread [P2] · added cohort-first single-locale re-consent test + seed-acceptability test [P2] · documented `actorRole`/`context` outside the signed envelope [P3].

**Owner decision (2026-06-15): HMAC-SHA256** for Tier-1 signing — ships now behind the swappable `signAcceptanceRecord()` seam (Ed25519 upgrade later only if third-party verification is needed).
