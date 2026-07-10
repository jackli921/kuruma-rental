# Consent Slice B — Renter Acceptance at Booking-Create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a renter self-serve-books an operator's car, atomically seal (snapshot + HMAC-sign) the renter's acceptance of that operator's published `OPERATOR_RENTAL_TERMS` document inside the booking-create transaction — pinned to the exact version the renter was shown, gated by a server-side enforcement flag, and dark until GA.

**Architecture:** The acceptance row is written by the existing consent ledger (#877) but is now produced inside `booking-creation.ts`'s `submitInTx` via a `consentRepo` added to `TransactionRepos`. The row keeps `operatorId = NULL` (operator recovered by `documentId → consent_documents.operatorId` join), so the `OPERATOR_AGREEMENT` half of the schema is untouched. The signing key is resolved OUTSIDE the tx (fail-fast); the doc read + snapshot + sign + insert run INSIDE it. All enforcement is gated on a new `serverOnly` flag `OPERATOR_TERMS_ENFORCEMENT` (default OFF).

**Tech Stack:** Bun workspace monorepo; Hono API on CF Workers (neon-http reads + neon-serverless `runTx` for interactive tx); Drizzle + Postgres; Vite + TanStack Router + shadcn/base-ui web; Vitest (unit + real-pg integration).

**Design of record:** `docs/superpowers/specs/2026-07-07-operator-usage-consent-design.md` §14. Reflects 3 owner locks + 4 architect fixes (C1 version-pinning, H1 server flag, H2 self-serve-only, H3 sign-outside-tx) + M1–M4/L1.

---

## Preconditions & sequencing

- **Land PR #1513 first** (in-memory `replaceOperatorDraftRows` atomicity parity) and rebase this branch onto the resulting `develop`. Slice B leans on the consent repo/tx machinery that #1513 hardens. If #1513 is not yet merged when starting, coordinate — Task 1 and Task 3 both touch `in-memory/consent.ts`.
- Work in the worktree `~/Dev/kuruma-consent-sliceb` (branch `feat/consent-slice-b`). Run `bun install` + `bun run db:migrate` + `bun run db:verify` (expect 5/5) in it first.
- **DB for integration tests:** a local Postgres migrated to head. `export DATABASE_URL='postgres://kuruma:kuruma@localhost:<port>/<db>'`. Unit tests run with **no** `DATABASE_URL`; integration tests (`test:integration`) run **with** it.
- All new behavior ships DARK: `OPERATOR_TERMS_ENFORCEMENT` defaults OFF, `VITE_FEATURE_OPERATOR_TERMS` stays OFF. No flag flips in this slice.
- **Commit discipline:** stage explicit paths only (never `git add -A`). Husky runs biome + tsc ×2 + size + boundaries on commit; run `bunx biome check --write <files>` before committing (the pre-commit hook has no `--write`).

---

## File Structure

**API (`packages/api/src`)**
- `services/consent-acceptance.ts` — **new.** Pure `buildSignedAcceptance()` + `expectedSubjectShape()` — the single row assembler + total shape function (M2/M3).
- `services/consent.ts` — consume the shared assembler + total shape check.
- `services/booking-creation.ts` — resolve signing key outside tx; in-tx resolve/pin-verify/snapshot/sign/insert; new deps.
- `services/operator-terms.ts` — gate `publish` on the enforcement thunk (H1).
- `repositories/types-consent.ts`, `repositories/drizzle/consent.ts`, `repositories/in-memory/consent.ts` — `findBookingAcceptance(bookingId, consentType)`; composite `assertUnique`; drizzle ctor `runTx` optional (M4).
- `repositories/types-transactions.ts`, `repositories/drizzle/transaction.ts`, `composition/repositories.ts` — `consentRepo` into the tx bundle.
- `routes/operators-terms-public.ts` — **new.** Renter read of an operator's published terms in a locale (for the modal).
- `routes/consent.ts` — accept endpoint rejects `OPERATOR_RENTAL_TERMS` (falls out of M3).
- `index.ts` — flag thunk `isOperatorTermsEnforced`; wire the new deps + route.
- `pg-errors.ts` — `CONSENT_BOOKING_TYPE_CONSTRAINT`.

**Shared (`packages/shared/src`)**
- `db/consent.ts` — generalize seal + widen CHECK.
- `validators/booking.ts` — `operatorRentalTermsAcceptedVersion` + `locale`.
- `feature-flags/registry.ts` — `OPERATOR_TERMS_ENFORCEMENT`.

**Web (`packages/web/src`)**
- `vite/bookings/api.ts` — thread the two new fields.
- `vite/operator-terms/api.ts` — renter fetch of published terms.
- `vite/reservation/OperatorTermsModal.tsx` — **new.** The modal.
- `vite/reservation/PaymentStep.tsx` — modal-on-Reserve + 422 handling.
- `vite/reservation/*` route + wizard — thread `operatorId` to `PaymentStep`.
- `messages/{en,ja,zh}.json` — modal strings.

**Migration:** `drizzle/0107_generalize_booking_consent_seal.sql` (generated).

**Deploy:** `.github/workflows/deploy.yml` — `CONSENT_SIGNING_KEY` presence check.

---

## Task 1: Generalize the booking consent seal (migration + repo contract)

Generalize the per-booking seal from `unique(bookingId)` to `unique(bookingId, consentType)` and widen the liability CHECK to admit `OPERATOR_RENTAL_TERMS`. Zero prod rows exist under `bookingId IS NOT NULL` (liability is still inline booking columns), so the index swap is safe.

**Files:**
- Modify: `packages/shared/src/db/consent.ts:97-99` (CHECK), `:111-113` (seal)
- Create: `drizzle/0107_generalize_booking_consent_seal.sql` (generated)
- Modify: `packages/api/src/pg-errors.ts` (new constraint constant)
- Modify: `packages/api/src/repositories/types-consent.ts:89` (`findBookingAcceptance` signature)
- Modify: `packages/api/src/repositories/drizzle/consent.ts:152-159` (finder), `in-memory/consent.ts:78-80` (finder), `:256-260` (assertUnique)
- Modify: `packages/api/src/services/consent.ts` (the one `findBookingAcceptance` caller in `findExisting`)
- Test: `packages/api/tests/integration/consent-repo.test.ts`, `packages/api/src/repositories/in-memory/consent.test.ts`

- [ ] **Step 1: Edit the schema — widen CHECK + generalize seal**

`packages/shared/src/db/consent.ts` — the CHECK (~L97):
```typescript
// BEFORE
check(
  'consent_liability_booking_chk',
  sql`(${t.consentType} = 'RENTER_LIABILITY') = (${t.bookingId} IS NOT NULL)`,
),
// AFTER
check(
  'consent_liability_booking_chk',
  sql`(${t.consentType} IN ('RENTER_LIABILITY', 'OPERATOR_RENTAL_TERMS')) = (${t.bookingId} IS NOT NULL)`,
),
```
The seal (~L111):
```typescript
// BEFORE
uniqueIndex('consent_unique_booking_liability')
  .on(t.bookingId)
  .where(sql`${t.bookingId} IS NOT NULL`),
// AFTER
uniqueIndex('consent_unique_booking_type')
  .on(t.bookingId, t.consentType)
  .where(sql`${t.bookingId} IS NOT NULL`),
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate --name generalize_booking_consent_seal`
Expected: creates `drizzle/0107_generalize_booking_consent_seal.sql`. **Inspect it** — it should DROP the old CHECK + old index and ADD the new ones, roughly:
```sql
ALTER TABLE "consent_acceptances" DROP CONSTRAINT "consent_liability_booking_chk";--> statement-breakpoint
DROP INDEX IF EXISTS "consent_unique_booking_liability";--> statement-breakpoint
CREATE UNIQUE INDEX "consent_unique_booking_type" ON "consent_acceptances" USING btree ("bookingId","consentType") WHERE "consent_acceptances"."bookingId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_liability_booking_chk" CHECK ((consentType IN ('RENTER_LIABILITY', 'OPERATOR_RENTAL_TERMS')) = (bookingId IS NOT NULL));
```
If drizzle-kit emits a different-but-equivalent form, keep it — verify Step 3 passes. Do NOT hand-edit `drizzle/`.

- [ ] **Step 3: Apply + verify**

Run: `bun run db:migrate && bun run db:verify`
Expected: `db:verify` shows 5 green checks (108 migrations applied).

- [ ] **Step 4: Add the pg-errors constant**

`packages/api/src/pg-errors.ts` — after the existing consent constants:
```typescript
/**
 * Partial unique index consent_acceptances(bookingId, consentType) WHERE bookingId
 * IS NOT NULL (#877 Slice B, generalized from the liability-only seal). One consent
 * row per (booking, type): a renter can hold both a RENTER_LIABILITY and an
 * OPERATOR_RENTAL_TERMS row for one booking, but not two of either.
 */
export const CONSENT_BOOKING_TYPE_CONSTRAINT = 'consent_unique_booking_type'
```

- [ ] **Step 5: Write the failing tests — finder takes consentType; two types coexist per booking**

`packages/api/src/repositories/in-memory/consent.test.ts` — replace the existing `seals booking-liability idempotency…` test body and add a coexistence test:
```typescript
it('seals booking idempotency per (bookingId, consentType) with constraint consent_unique_booking_type', async () => {
  const liability: NewConsentAcceptance = {
    ...baseAcceptance,
    consentType: 'RENTER_LIABILITY' as const,
    bookingId: 'booking_abc',
  }
  const created = await repo.createAcceptance(liability)
  // Same booking + same type → sealed.
  await expect(repo.createAcceptance(liability)).rejects.toMatchObject({
    code: '23505',
    constraint_name: 'consent_unique_booking_type',
  })
  // Same booking, DIFFERENT type (operator terms) → allowed to coexist.
  const terms = await repo.createAcceptance({
    ...baseAcceptance,
    consentType: 'OPERATOR_RENTAL_TERMS' as const,
    documentId: 'doc_terms',
    bookingId: 'booking_abc',
  })
  expect(terms.id).not.toBe(created.id)
  // The finder is type-scoped: it returns the row matching the requested type.
  expect((await repo.findBookingAcceptance('booking_abc', 'OPERATOR_RENTAL_TERMS'))?.id).toBe(terms.id)
  expect((await repo.findBookingAcceptance('booking_abc', 'RENTER_LIABILITY'))?.id).toBe(created.id)
})
```

- [ ] **Step 6: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- src/repositories/in-memory/consent.test.ts -t "booking idempotency per"`
Expected: FAIL — `findBookingAcceptance` takes one arg; `assertUnique` throws the old name and rejects the 2nd (different-type) row.

- [ ] **Step 7: Update the interface + both repo impls**

`packages/api/src/repositories/types-consent.ts:89`:
```typescript
// BEFORE
findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined>
// AFTER
findBookingAcceptance(bookingId: string, consentType: ConsentType): Promise<ConsentAcceptance | undefined>
```
`packages/api/src/repositories/drizzle/consent.ts:152`:
```typescript
async findBookingAcceptance(
  bookingId: string,
  consentType: ConsentType,
): Promise<ConsentAcceptance | undefined> {
  const [row] = await this.db
    .select()
    .from(consentAcceptances)
    .where(and(eq(consentAcceptances.bookingId, bookingId), eq(consentAcceptances.consentType, consentType)))
    .limit(1)
  return row ? toAcceptance(row) : undefined
}
```
`packages/api/src/repositories/in-memory/consent.ts:78`:
```typescript
async findBookingAcceptance(
  bookingId: string,
  consentType: ConsentType,
): Promise<ConsentAcceptance | undefined> {
  return this.acceptances.find((a) => a.bookingId === bookingId && a.consentType === consentType)
}
```
`packages/api/src/repositories/in-memory/consent.ts:256-260` (`assertUnique` booking branch) — key on both + rename the constraint:
```typescript
// BEFORE
if (d.bookingId !== null) {
  if (this.acceptances.some((a) => a.bookingId === d.bookingId))
    throw uniqueViolation('consent_unique_booking_liability')
  return
}
// AFTER
if (d.bookingId !== null) {
  if (
    this.acceptances.some((a) => a.bookingId === d.bookingId && a.consentType === d.consentType)
  )
    throw uniqueViolation('consent_unique_booking_type')
  return
}
```
Also update the `assertUnique` comment above the early-returns (~L250-255): the disjointness note now reads "a booking row is keyed by `(bookingId, consentType)` — RENTER_LIABILITY and OPERATOR_RENTAL_TERMS coexist for one booking; the operator branch stays keyed on `(operatorId, documentId)`."

- [ ] **Step 8: Update the sole `findBookingAcceptance` caller**

`packages/api/src/services/consent.ts` — in `findExisting(...)`, the liability branch calls `findBookingAcceptance(bookingId)`. Pass the type: `this.repo.findBookingAcceptance(bookingId, type)`. (Find the exact call with `grep -n findBookingAcceptance packages/api/src/services/consent.ts`.)

- [ ] **Step 9: Run unit tests — verify green**

Run: `bun run --filter @kuruma/api test -- src/repositories/in-memory/consent.test.ts`
Expected: PASS (all, including the new coexistence test).

- [ ] **Step 10: Add the real-pg integration proof**

`packages/api/tests/integration/consent-repo.test.ts` — add (mirror the file's existing seed/cleanup helpers; a RENTER_LIABILITY and an OPERATOR_RENTAL_TERMS both need a published `consent_documents` row + a `bookings` row to satisfy FKs — reuse the file's existing fixtures/factories):
```typescript
it('allows RENTER_LIABILITY and OPERATOR_RENTAL_TERMS to coexist for one booking, seals each per type (#877 Slice B)', async () => {
  // ...seed one booking + a published liability doc + a published operator-terms doc...
  await repo.createAcceptance(liabilityRow)        // bookingId set, type RENTER_LIABILITY
  const terms = await repo.createAcceptance(termsRow) // same bookingId, type OPERATOR_RENTAL_TERMS
  expect(terms.bookingId).toBe(BOOKING_ID)
  // second of the same type trips the generalized seal
  await expect(repo.createAcceptance(termsRow)).rejects.toSatisfy(
    (e) => pgConstraintName(e) === CONSENT_BOOKING_TYPE_CONSTRAINT,
  )
  expect((await repo.findBookingAcceptance(BOOKING_ID, 'OPERATOR_RENTAL_TERMS'))?.id).toBe(terms.id)
})
```

- [ ] **Step 11: Run integration + verify, then commit**

Run: `DATABASE_URL=... bun run --filter @kuruma/api test:integration -- consent-repo.test.ts` → PASS.
Run: `bun run --filter @kuruma/api typecheck && bun run --filter @kuruma/shared typecheck` → 0.
```bash
bunx biome check --write packages/shared/src/db/consent.ts packages/api/src/pg-errors.ts packages/api/src/repositories/{types-consent.ts,drizzle/consent.ts,in-memory/consent.ts,in-memory/consent.test.ts} packages/api/src/services/consent.ts packages/api/tests/integration/consent-repo.test.ts
git add packages/shared/src/db/consent.ts drizzle/0107_generalize_booking_consent_seal.sql drizzle/meta packages/api/src/pg-errors.ts packages/api/src/repositories packages/api/src/services/consent.ts packages/api/tests/integration/consent-repo.test.ts
git commit -m "feat(#877): generalize the booking consent seal to (bookingId, consentType)"
```

---

## Task 2: Total subject-shape + shared signed-acceptance assembler (M2/M3), accept-endpoint reject

One pure module owns the acceptance-row assembly (one signer, one snapshot shape) and a total shape function that fails closed. `POST /consent/accept` then rejects `OPERATOR_RENTAL_TERMS` for free (its payload carries no `bookingId`).

**Files:**
- Create: `packages/api/src/services/consent-acceptance.ts`
- Create: `packages/api/src/services/consent-acceptance.test.ts`
- Modify: `packages/api/src/services/consent.ts` (`buildRow` → delegate; shape check → total fn)
- Test: `packages/api/tests/routes/consent.test.ts` (reject OPERATOR_RENTAL_TERMS)

- [ ] **Step 1: Write the failing test for the total shape function**

`packages/api/src/services/consent-acceptance.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { expectedSubjectShape } from './consent-acceptance'

describe('expectedSubjectShape', () => {
  it('is total and fails closed — every ConsentType maps to an explicit (bookingId, operatorId) shape', () => {
    expect(expectedSubjectShape('RENTER_LIABILITY')).toEqual({ bookingId: true, operatorId: false })
    expect(expectedSubjectShape('OPERATOR_RENTAL_TERMS')).toEqual({ bookingId: true, operatorId: false })
    expect(expectedSubjectShape('OPERATOR_AGREEMENT')).toEqual({ bookingId: false, operatorId: true })
    expect(expectedSubjectShape('RENTER_TOS')).toEqual({ bookingId: false, operatorId: false })
    expect(expectedSubjectShape('PRIVACY_POLICY')).toEqual({ bookingId: false, operatorId: false })
  })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- src/services/consent-acceptance.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

`packages/api/src/services/consent-acceptance.ts`:
```typescript
import { type ConsentType, CONSENT_TYPES } from '@kuruma/shared/enums'
import { CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentMethod } from '@kuruma/shared/enums'
import type { NewConsentAcceptance } from '../repositories/types'
import { type SigningKey, signAcceptanceRecord } from './consent-signing'

/** The subject columns a given consent type MUST carry, as a total function over
 *  ConsentType. Exhaustive → an unhandled/future type fails CLOSED (returns the
 *  no-subject shape) rather than the fail-open XOR the two-boolean check had. */
export function expectedSubjectShape(type: ConsentType): { bookingId: boolean; operatorId: boolean } {
  switch (type) {
    case 'RENTER_LIABILITY':
    case 'OPERATOR_RENTAL_TERMS':
      return { bookingId: true, operatorId: false }
    case 'OPERATOR_AGREEMENT':
      return { bookingId: false, operatorId: true }
    default:
      return { bookingId: false, operatorId: false }
  }
}

/** Everything the signer + persisted row need about the document being accepted. */
export interface AcceptanceDocument {
  id: string
  type: ConsentType
  version: string
  locale: string
  contentHash: string
  title: string
  body: string
  acceptanceLabel: string
}

export interface AcceptanceSubject {
  userId: string
  actorRole: string | null
  operatorId: string | null
  operatorMembershipId: string | null
  bookingId: string | null
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

/** The ONE assembler of a signed acceptance row. Both ConsentService.recordAcceptance
 *  and the booking-create path call this, so the method, signed-field set, snapshot
 *  shape, and canonical version can never drift between the two write paths (M2). */
export function buildSignedAcceptance(
  doc: AcceptanceDocument,
  subject: AcceptanceSubject,
  key: SigningKey | undefined,
): NewConsentAcceptance {
  const method: ConsentMethod = 'CLICKWRAP'
  const signed = key
    ? signAcceptanceRecord(
        {
          documentId: doc.id,
          contentHash: doc.contentHash,
          consentType: doc.type,
          version: doc.version,
          locale: doc.locale,
          userId: subject.userId,
          operatorId: subject.operatorId,
          operatorMembershipId: subject.operatorMembershipId,
          bookingId: subject.bookingId,
          method,
          acceptedAt: subject.acceptedAt,
          ipAddress: subject.ipAddress,
          userAgent: subject.userAgent,
        },
        key,
      )
    : undefined
  return {
    documentId: doc.id,
    consentType: doc.type,
    userId: subject.userId,
    operatorId: subject.operatorId,
    operatorMembershipId: subject.operatorMembershipId,
    actorRole: subject.actorRole,
    bookingId: subject.bookingId,
    acceptedAt: subject.acceptedAt,
    context: null,
    ipAddress: subject.ipAddress,
    userAgent: subject.userAgent,
    method,
    recordSignature: signed?.signature ?? null,
    signingKeyId: signed?.signingKeyId ?? null,
    signatureCanonicalVersion: signed ? CANONICAL_VERSION : null,
    documentSnapshot: {
      version: doc.version,
      locale: doc.locale,
      title: doc.title,
      body: doc.body,
      acceptanceLabel: doc.acceptanceLabel,
      contentHash: doc.contentHash,
    },
  }
}
```
(Verify `CONSENT_TYPES` import is used or drop it; the switch is exhaustive without it. If TS `noImplicitReturns`/exhaustiveness needs it, add `const _exhaustive: never = type` in `default` guarded by a `CONSENT_TYPES.includes` check — but the `default` return already makes it total.)

- [ ] **Step 4: Run — verify green**

Run: `bun run --filter @kuruma/api test -- src/services/consent-acceptance.test.ts` → PASS.

- [ ] **Step 5: Delegate `ConsentService.buildRow` + total shape check**

`packages/api/src/services/consent.ts` — the shape check (~L68-71) becomes:
```typescript
const shape = expectedSubjectShape(doc.type)
if (shape.bookingId !== (bookingId !== null) || shape.operatorId !== (operatorId !== null))
  return { ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' }
```
Replace the `buildRow` body (~L149-217) with a thin delegation to `buildSignedAcceptance`:
```typescript
private buildRow(
  doc: AcceptanceDocument,
  input: RecordAcceptanceInput,
  meta: RecordAcceptanceMeta,
  operatorId: string | null,
  bookingId: string | null,
): NewConsentAcceptance {
  return buildSignedAcceptance(
    doc,
    {
      userId: input.userId,
      actorRole: input.actorRole,
      operatorId,
      operatorMembershipId: input.operatorMembershipId ?? null,
      bookingId,
      acceptedAt: meta.now,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
    this.getSigningKey(),
  )
}
```
Add imports at top of `consent.ts`: `import { type AcceptanceDocument, buildSignedAcceptance, expectedSubjectShape } from './consent-acceptance'`. Remove now-unused imports (`signAcceptanceRecord`, `CANONICAL_VERSION`, `ConsentMethod`) if the delegation leaves them dangling — let biome flag them.

- [ ] **Step 6: Write the failing route test — accept rejects OPERATOR_RENTAL_TERMS**

`packages/api/tests/routes/consent.test.ts` — add (mirror the file's existing accept-endpoint harness; seed a published `OPERATOR_RENTAL_TERMS` doc with `operatorId` set):
```typescript
it('POST /consent/accept rejects OPERATOR_RENTAL_TERMS (booking-path only) with 400', async () => {
  // documentId points at a published OPERATOR_RENTAL_TERMS doc; the accept payload has no bookingId,
  // so the total shape check (bookingId expected true, actual false) rejects it.
  const res = await postAccept({ documentId: OPERATOR_TERMS_DOC_ID })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ success: false, error: 'SUBJECT_SHAPE_INVALID' })
})
```

- [ ] **Step 7: Run — verify green (impl from Step 5 already satisfies it)**

Run: `bun run --filter @kuruma/api test -- src/services/consent.test.ts tests/routes/consent.test.ts` → PASS.
Sabotage-check: temporarily make `expectedSubjectShape('OPERATOR_RENTAL_TERMS')` return `{ bookingId: false, operatorId: false }` → the route test flips to 2xx/500 → revert.

- [ ] **Step 8: Commit**

```bash
bunx biome check --write packages/api/src/services/consent-acceptance.ts packages/api/src/services/consent-acceptance.test.ts packages/api/src/services/consent.ts packages/api/tests/routes/consent.test.ts
git add packages/api/src/services/consent-acceptance.ts packages/api/src/services/consent-acceptance.test.ts packages/api/src/services/consent.ts packages/api/tests/routes/consent.test.ts
git commit -m "refactor(#877): one signed-acceptance assembler + total subject-shape check"
```

---

## Task 3: Wire `consentRepo` into the booking transaction (M4)

Add a narrowed `consentRepo` to `TransactionRepos` so `submitInTx` can resolve + insert acceptance rows in the booking tx. The `Pick<>` makes calling authoring methods a compile error; the drizzle ctor's `runTx` becomes optional so the factory needs no sentinel.

**Files:**
- Modify: `packages/api/src/repositories/types-transactions.ts` (add `consentRepo`)
- Modify: `packages/api/src/repositories/drizzle/consent.ts` (ctor `runTx?` optional + guard)
- Modify: `packages/api/src/repositories/drizzle/transaction.ts` (construct `consentRepo`)
- Modify: `packages/api/src/composition/repositories.ts` (in-memory tx bundle)
- Test: `packages/api/src/repositories/in-memory/consent.test.ts` (ctor-optional guard)

- [ ] **Step 1: Narrow-type `consentRepo` on the bundle**

`packages/api/src/repositories/types-transactions.ts` — add the import and the field (mirror the `operatorRepo` Pick):
```typescript
import type { ConsentRepository } from './types-consent'
// ...inside TransactionRepos, after operatorRepo:
  // #877 Slice B: the renter's operator-terms acceptance is sealed in the booking
  // tx. Narrowed to the 4 methods the booking path uses (ISP) — calling an authoring
  // method (replaceOperatorDraftRows) on the booking bundle is then a COMPILE error,
  // not a runtime throw.
  consentRepo: Pick<
    ConsentRepository,
    | 'findLatestPublishedVersionForOperator'
    | 'findPublishedOperatorDocument'
    | 'findBookingAcceptance'
    | 'createAcceptance'
  >
```

- [ ] **Step 2: Write the failing guard test**

`packages/api/src/repositories/in-memory/consent.test.ts`:
```typescript
it('drizzle-parity: replaceOperatorDraftRows requires a RunTx (guards when constructed without one)', async () => {
  const { DrizzleConsentRepository } = await import('../drizzle/consent')
  // biome-ignore lint: intentionally construct without the optional runTx to prove the guard.
  const repo = new (DrizzleConsentRepository as unknown as new (db: unknown) => {
    replaceOperatorDraftRows: (...a: unknown[]) => Promise<unknown>
  })({})
  await expect(repo.replaceOperatorDraftRows('op', 'OPERATOR_RENTAL_TERMS', 'v1', [])).rejects.toThrow(
    /RunTx/,
  )
})
```

- [ ] **Step 3: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- src/repositories/in-memory/consent.test.ts -t "requires a RunTx"`
Expected: FAIL — ctor currently requires `runTx`; `this.runTransaction` is defined, no guard.

- [ ] **Step 4: Make the drizzle ctor `runTx` optional + guard**

`packages/api/src/repositories/drizzle/consent.ts`:
```typescript
constructor(
  private readonly db: Db,
  private readonly runTransaction?: RunTx,
) {}
```
At the top of `replaceOperatorDraftRows`, before `return this.runTransaction(...)`:
```typescript
if (!this.runTransaction)
  throw new Error('DrizzleConsentRepository.replaceOperatorDraftRows requires a RunTx (authoring path only)')
const runTx = this.runTransaction
return runTx(async (tx) => { /* ...existing body... */ })
```

- [ ] **Step 5: Construct `consentRepo` in the drizzle tx factory (no sentinel)**

`packages/api/src/repositories/drizzle/transaction.ts` — add to the returned bundle (after `operatorRepo`):
```typescript
// #877 Slice B: tx-bound so the renter's operator-terms acceptance INSERT shares
// the booking's point-in-time snapshot. No RunTx arg — the booking path never
// calls the authoring tx method (and the Pick<> type forbids it).
consentRepo: new DrizzleConsentRepository(txDb),
```
Add the import: `import { DrizzleConsentRepository } from './consent'`.

- [ ] **Step 6: Add `consentRepo` to the in-memory tx bundle**

`packages/api/src/composition/repositories.ts:542-561` — add `consentRepo,` to the object the in-memory `runInTransaction` passes (the `consentRepo` singleton already exists in `buildInMemoryRepos`; if the in-memory build names it differently, use that binding).

- [ ] **Step 7: Run tests + typecheck — verify green**

Run: `bun run --filter @kuruma/api test -- src/repositories/in-memory/consent.test.ts && bun run --filter @kuruma/api typecheck`
Expected: PASS + tsc 0. (Composition root `new DrizzleConsentRepository(db, tx)` still compiles — `runTx` is now optional, still supplied there.)

- [ ] **Step 8: Commit**

```bash
bunx biome check --write packages/api/src/repositories/types-transactions.ts packages/api/src/repositories/drizzle/consent.ts packages/api/src/repositories/drizzle/transaction.ts packages/api/src/composition/repositories.ts packages/api/src/repositories/in-memory/consent.test.ts
git add packages/api/src/repositories/types-transactions.ts packages/api/src/repositories/drizzle packages/api/src/composition/repositories.ts packages/api/src/repositories/in-memory/consent.test.ts
git commit -m "feat(#877): add narrowed consentRepo to the booking TransactionRepos"
```

---

## Task 4: Server enforcement flag `OPERATOR_TERMS_ENFORCEMENT` (H1)

A new `serverOnly` flag (default OFF) gates the publish transition and the booking-time require. While OFF, no operator can publish terms → no acceptance is ever required → the feature is truly dark server-side.

**Files:**
- Modify: `packages/shared/src/feature-flags/registry.ts` (new entry)
- Modify: `packages/api/src/services/operator-terms.ts` (gate `publish`)
- Modify: `packages/api/src/index.ts` (thunk + inject)
- Test: `packages/api/src/services/operator-terms.test.ts`

- [ ] **Step 1: Register the flag**

`packages/shared/src/feature-flags/registry.ts` — add to `REGISTRY` (mirror `SHARED_CATALOG`):
```typescript
// #877 Slice B: server-enforced kill-switch for operator rental-terms. Default OFF
// in CODE (serverDefault:false) — the feature_flags table is override-only. While
// OFF, OperatorTermsService.publish is rejected (no published row can exist) and the
// booking path never requires acceptance. GA flips this ON together with the web
// VITE_FEATURE_OPERATOR_TERMS gate (#1476). serverOnly: the API enforces it.
OPERATOR_TERMS_ENFORCEMENT: {
  label: 'Operator rental-terms enforcement',
  runtimeControlled: true,
  serverOnly: true,
  serverDefault: false,
},
```
The feature-flags parity test (`feature-flags-parity.test.ts`) treats `serverOnly` flags like `SHARED_CATALOG` (no `VITE_*` env expected) — no env entry needed.

- [ ] **Step 2: Write the failing test — publish is gated**

`packages/api/src/services/operator-terms.test.ts` — the service ctor gains an `isEnforced` thunk (last arg). Add:
```typescript
it('rejects publish with 403 when enforcement is OFF (dark) and publishes when ON', async () => {
  const off = new OperatorTermsService(repo, () => false)
  await repo.replaceOperatorDraftRows(OP, TYPE, 'v1', [draftRow()])
  const blocked = await off.publish(OP, 'v1', NOW)
  expect(blocked).toMatchObject({ ok: false, status: 403 })

  const on = new OperatorTermsService(repo, () => true)
  const ok = await on.publish(OP, 'v1', NOW)
  expect(ok.ok).toBe(true)
})
```
(Match the existing test file's construction of `OperatorTermsService` + `repo`; if the ctor already takes args, append `isEnforced` as the final parameter and update existing `new OperatorTermsService(...)` call sites in the test to pass `() => true`.)

- [ ] **Step 3: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- src/services/operator-terms.test.ts -t "enforcement is OFF"`
Expected: FAIL — ctor has no `isEnforced`; publish isn't gated.

- [ ] **Step 4: Gate `publish`**

`packages/api/src/services/operator-terms.ts` — add the dep + guard:
```typescript
constructor(
  private readonly repo: ConsentRepository,
  private readonly isEnforced: () => boolean | Promise<boolean> = () => false,
) {}

async publish(operatorId: string, version: string, now: Date): Promise<OperatorTermsResult> {
  if (!(await this.isEnforced()))
    return { ok: false, status: 403, error: 'Operator rental terms are not enabled' }
  // ...existing publish body...
}
```
(If `OperatorTermsService` already has a ctor with args, add `isEnforced` as the last param.)

- [ ] **Step 5: Run — verify green**

Run: `bun run --filter @kuruma/api test -- src/services/operator-terms.test.ts` → PASS.

- [ ] **Step 6: Wire the thunk in the composition root**

`packages/api/src/index.ts` — near the `isSharedCatalogEnabled` wiring (~L495):
```typescript
// #877 Slice B: operator rental-terms enforcement is server-gated. ONE narrow thunk
// (ISP) feeds both the authoring publish gate and the booking-create require branch.
const isOperatorTermsEnforced = () => featureFlagsService.isEnabled('OPERATOR_TERMS_ENFORCEMENT')
```
Pass `isOperatorTermsEnforced` as the last arg wherever `OperatorTermsService` is constructed in `index.ts`. (It is also injected into `BookingCreationService` in Task 6.)

- [ ] **Step 7: Typecheck + commit**

Run: `bun run --filter @kuruma/api typecheck && bun run --filter @kuruma/shared typecheck` → 0.
```bash
bunx biome check --write packages/shared/src/feature-flags/registry.ts packages/api/src/services/operator-terms.ts packages/api/src/services/operator-terms.test.ts packages/api/src/index.ts
git add packages/shared/src/feature-flags/registry.ts packages/api/src/services/operator-terms.ts packages/api/src/services/operator-terms.test.ts packages/api/src/index.ts
git commit -m "feat(#877): add OPERATOR_TERMS_ENFORCEMENT server flag, gate publish"
```

---

## Task 5: Booking request contract — pinned version + locale (C1/M1)

Add `operatorRentalTermsAcceptedVersion` and `locale` to the create-booking request so the client pins exactly what it displayed.

**Files:**
- Modify: `packages/shared/src/validators/booking.ts` (add two optional fields to `bookingCommonFields`)
- Modify: `packages/web/src/vite/bookings/api.ts` (`CreateBookingDraft` + `createBooking` body)
- Test: `packages/shared` validator test (find the existing `booking` validator test) or `packages/api/tests/routes/bookings*.test.ts`

- [ ] **Step 1: Write the failing validator test**

In the existing booking-validator test (find via `grep -rln createBookingSchema packages/shared packages/api/tests`):
```typescript
it('accepts an operator-terms version pin + presentation locale', () => {
  const parsed = createBookingSchema.parse({
    fulfillmentMode: 'SPECIFIC',
    requestedVehicleId: UUID,
    pickupLocationId: UUID,
    dropoffLocationId: UUID,
    startAt: ISO, endAt: ISO_LATER,
    operatorRentalTermsAcceptedVersion: 'v2',
    locale: 'ja',
  })
  expect(parsed).toMatchObject({ operatorRentalTermsAcceptedVersion: 'v2', locale: 'ja' })
})
```

- [ ] **Step 2: Run — verify it fails**

Run the shared test suite for that file. Expected: the two fields are stripped/undefined (unknown keys) → FAIL on `toMatchObject`.

- [ ] **Step 3: Add the fields**

`packages/shared/src/validators/booking.ts` — inside `bookingCommonFields`, after `disclaimerAccepted`:
```typescript
// #877 Slice B: the renter PINS the operator rental-terms version they were shown
// (C1 — the server 422s if it no longer matches the latest published). `locale` is
// the presentation locale to snapshot; both optional (only DIRECT self-serve sends
// them; a booking for an operator with no published terms omits them).
operatorRentalTermsAcceptedVersion: z.string().trim().min(1).optional(),
locale: z.enum(['en', 'ja', 'zh']).optional(),
```

- [ ] **Step 4: Run — verify green**

Run the shared validator suite → PASS.

- [ ] **Step 5: Thread through the web api client**

`packages/web/src/vite/bookings/api.ts` — extend `CreateBookingDraft` (or the input type) with the two optional fields, and add to the POST body in `createBooking` (~L151-164):
```typescript
...(input.operatorRentalTermsAcceptedVersion
  ? { operatorRentalTermsAcceptedVersion: input.operatorRentalTermsAcceptedVersion, locale: input.locale }
  : {}),
```

- [ ] **Step 6: Typecheck + commit**

Run: `bun run --filter @kuruma/shared typecheck && bun run --filter @kuruma/web typecheck` → 0.
```bash
bunx biome check --write packages/shared/src/validators/booking.ts packages/web/src/vite/bookings/api.ts <the validator test file>
git add packages/shared/src/validators/booking.ts packages/web/src/vite/bookings/api.ts <the validator test file>
git commit -m "feat(#877): add operator-terms version pin + locale to the booking request"
```

---

## Task 6: Seal the acceptance in `submitInTx` (C1/H2/H3/M1)

The core. For renter self-serve bookings, when the operator has published terms AND enforcement is ON, resolve the pinned doc, verify `pinned === latest`, snapshot + sign (key resolved outside the tx), and insert the acceptance in the same tx as the booking. Any mismatch returns a clean 422 (whole tx rolls back).

**Files:**
- Modify: `packages/api/src/services/booking-creation.ts` (new deps; key resolve in `create()`; consent block in `snapshotAndInsert`)
- Modify: `packages/api/src/index.ts` (inject the two new deps)
- Test: `packages/api/tests/routes/booking-consent-gate.test.ts` (mirror this existing file's harness), unit tests in `packages/api/src/services/booking-creation*.test.ts`

**Behavior contract (implement exactly):** In `snapshotAndInsert`, immediately AFTER the booking row is created (`booking.id` exists), run this block ONLY when `input.source === 'DIRECT' && !input.walkInCustomer`:
1. If `!(await isOperatorTermsEnforced())` → skip entirely (dark). 
2. `latest = repos.consentRepo.findLatestPublishedVersionForOperator(operatorId, 'OPERATOR_RENTAL_TERMS', now)`.
3. If `latest === undefined` → no terms → skip (no row).
4. If `!input.operatorRentalTermsAcceptedVersion` → `return { ok: false, status: 422, error: 'OPERATOR_TERMS_REQUIRED' }`.
5. If `input.operatorRentalTermsAcceptedVersion !== latest` → `return { ok: false, status: 422, error: 'OPERATOR_TERMS_CHANGED' }`.
6. Resolve the doc: `doc = findPublishedOperatorDocument(operatorId, type, latest, input.locale ?? 'en')`; if undefined (locale not authored), fall back to `'en'`; if still undefined → `return { ok:false, status:422, error:'OPERATOR_TERMS_REQUIRED' }` (defensive).
7. `row = buildSignedAcceptance(doc, { userId: bookingRenterId, actorRole: ctx.role, operatorId: null, operatorMembershipId: null, bookingId: booking.id, acceptedAt: now, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null }, this.consentSigningKey)` then `await repos.consentRepo.createAcceptance(row)`.

The signing key (`this.consentSigningKey`) is resolved ONCE in `create()` BEFORE `runInTransaction` (H3): `const consentSigningKey = this.getConsentSigningKey()`. In production a missing key throws HERE (fail-fast, no tx work). Thread it into `submitInTx` → `snapshotAndInsert` (add a param, or store on a per-call basis — prefer a param to keep the service stateless).

- [ ] **Step 1: Add the two constructor deps**

`packages/api/src/services/booking-creation.ts` — add to the ctor:
```typescript
private readonly isOperatorTermsEnforced: () => boolean | Promise<boolean> = () => false,
private readonly getConsentSigningKey: () => SigningKey | undefined = resolveSigningKey,
```
Imports: `import { type SigningKey, resolveSigningKey } from './consent-signing'` and `import { buildSignedAcceptance } from './consent-acceptance'`.

- [ ] **Step 2: Resolve the key outside the tx (H3, fail-fast)**

In `create()`, before the `runInTransaction` call (~L129), add:
```typescript
// #877 Slice B (H3): resolve the consent signing key BEFORE the tx so a missing
// CONSENT_SIGNING_KEY fails fast (prod throws) instead of 500ing after tx work.
const consentSigningKey = this.getConsentSigningKey()
```
Thread `consentSigningKey` into `submitInTx(...)` and onward to `snapshotAndInsert(...)` (add a parameter to both signatures).

- [ ] **Step 3: Write the failing gate test**

`packages/api/tests/routes/booking-consent-gate.test.ts` (mirror the existing harness — in-memory repos, DIRECT renter, enforcement thunk `() => true`, a seeded published operator-terms doc for the booked vehicle's operator). Add four cases:
```typescript
describe('operator rental-terms gate (#877 Slice B)', () => {
  it('422 OPERATOR_TERMS_REQUIRED when terms are published and no version is pinned', async () => {
    const res = await createDirectBooking({ /* no operatorRentalTermsAcceptedVersion */ })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'OPERATOR_TERMS_REQUIRED' })
  })
  it('422 OPERATOR_TERMS_CHANGED when the pinned version is stale', async () => {
    const res = await createDirectBooking({ operatorRentalTermsAcceptedVersion: 'v1' }) // latest is v2
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'OPERATOR_TERMS_CHANGED' })
  })
  it('seals the acceptance (signed, bookingId set, operatorId NULL) when the pin matches', async () => {
    const res = await createDirectBooking({ operatorRentalTermsAcceptedVersion: 'v2', locale: 'ja' })
    expect(res.status).toBe(201)
    const acc = await consentRepo.findBookingAcceptance(bookingIdFrom(res), 'OPERATOR_RENTAL_TERMS')
    expect(acc).toMatchObject({ operatorId: null, method: 'CLICKWRAP', signatureCanonicalVersion: 'v1' })
    expect(acc?.documentSnapshot).toMatchObject({ version: 'v2', locale: 'ja' })
    expect(acc?.recordSignature).toEqual(expect.any(String))
  })
  it('skips the gate entirely for a MANUAL/walk-in booking (operator books their own car)', async () => {
    const res = await createManualBooking({}) // no pin
    expect(res.status).toBe(201) // NOT 422 — H2 self-serve-only
  })
  it('skips the gate when enforcement is OFF (dark)', async () => {
    const res = await createDirectBooking({}, { enforced: false })
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 4: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- tests/routes/booking-consent-gate.test.ts -t "operator rental-terms gate"`
Expected: FAIL — no gate exists yet (bookings succeed unconditionally / no acceptance row).

- [ ] **Step 5: Implement the consent block in `snapshotAndInsert`**

Insert immediately after the `const booking = await repos.bookingRepo.create(...)` call (~L772), before the `bookingEventRepo.append` (~L774):
```typescript
// #877 Slice B: seal the renter's operator rental-terms acceptance in THIS tx
// (atomic with the booking). Only renter self-serve (DIRECT, non-walk-in) — MANUAL/
// walk-in/TRIP_COM are exempt (H2), mirroring the liability-disclaimer rule.
if (input.source === 'DIRECT' && !input.walkInCustomer && (await this.isOperatorTermsEnforced())) {
  const TERMS_TYPE = 'OPERATOR_RENTAL_TERMS' as const
  const latest = await repos.consentRepo.findLatestPublishedVersionForOperator(operatorId, TERMS_TYPE, now)
  if (latest) {
    const pinned = input.operatorRentalTermsAcceptedVersion
    if (!pinned) return { ok: false, status: 422, error: 'OPERATOR_TERMS_REQUIRED' }
    if (pinned !== latest) return { ok: false, status: 422, error: 'OPERATOR_TERMS_CHANGED' }
    const locale = input.locale ?? 'en'
    const doc =
      (await repos.consentRepo.findPublishedOperatorDocument(operatorId, TERMS_TYPE, latest, locale)) ??
      (await repos.consentRepo.findPublishedOperatorDocument(operatorId, TERMS_TYPE, latest, 'en'))
    if (!doc) return { ok: false, status: 422, error: 'OPERATOR_TERMS_REQUIRED' }
    await repos.consentRepo.createAcceptance(
      buildSignedAcceptance(
        doc,
        {
          userId: bookingRenterId,
          actorRole: ctx.role,
          operatorId: null,
          operatorMembershipId: null,
          bookingId: booking.id,
          acceptedAt: now,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
        consentSigningKey,
      ),
    )
  }
}
```
Confirm the local names in scope at that point: `operatorId`, `bookingRenterId`, `booking`, `now`, `ctx`, `input`, `consentSigningKey` (the threaded param). `ctx.ipAddress`/`ctx.userAgent` — if `CallerContext` lacks them, pass `null` (the disclaimer path stamps server-side too; IP/UA are best-effort). Verify `CallerContext` shape via `grep -n "interface CallerContext" packages/api/src`.

- [ ] **Step 6: Run — verify green + sabotage**

Run: `bun run --filter @kuruma/api test -- tests/routes/booking-consent-gate.test.ts` → PASS.
Sabotage: change `input.source === 'DIRECT'` to `true` → the MANUAL-skip test flips to 422 → revert. Change `pinned !== latest` to `false` → the stale-pin test flips → revert.

- [ ] **Step 7: Inject the deps in the composition root**

`packages/api/src/index.ts` — pass `isOperatorTermsEnforced` (from Task 4) and `resolveSigningKey` (default) as the new final args wherever `BookingCreationService` is constructed. (Search `new BookingCreationService(` — there may be more than one wiring; update each.)

- [ ] **Step 8: Full api suite + integration + commit**

Run: `bun run --filter @kuruma/api test` (no DATABASE_URL) → all green.
Run: `DATABASE_URL=... bun run --filter @kuruma/api test:integration` → all green (a real-pg booking-create that seals the acceptance is the strongest proof; add one to `tests/integration/` mirroring the existing booking-create integration test if present).
```bash
bunx biome check --write packages/api/src/services/booking-creation.ts packages/api/src/index.ts packages/api/tests/routes/booking-consent-gate.test.ts
git add packages/api/src/services/booking-creation.ts packages/api/src/index.ts packages/api/tests/routes/booking-consent-gate.test.ts
git commit -m "feat(#877): seal renter operator-terms acceptance atomically at booking-create"
```

---

## Task 7: Renter read endpoint — an operator's published terms in a locale

The modal needs the operator's current published terms. Add a renter-facing GET returning the published `OPERATOR_RENTAL_TERMS` doc (version + title + body + acceptanceLabel) in a locale, or empty.

**Files:**
- Create: `packages/api/src/routes/operators-terms-public.ts`
- Modify: `packages/api/src/index.ts` (mount it; reuse the existing `ConsentService`/consentRepo reads)
- Test: `packages/api/tests/routes/operators-terms-public.test.ts`

- [ ] **Step 1: Write the failing route test**

`packages/api/tests/routes/operators-terms-public.test.ts` (mirror an existing renter-read route test harness):
```typescript
it('GET /operators/:operatorId/rental-terms returns the published doc in the locale (fallback en)', async () => {
  // seed a published OPERATOR_RENTAL_TERMS v2 (en + ja) for OP
  const res = await get(`/operators/${OP}/rental-terms?locale=ja`)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ success: true, data: { version: 'v2', locale: 'ja' } })
})
it('returns 200 with data: null when the operator has no published terms', async () => {
  const res = await get(`/operators/${OP_NO_TERMS}/rental-terms`)
  expect(await res.json()).toMatchObject({ success: true, data: null })
})
it('returns null when enforcement is OFF, even if a row somehow exists (dark)', async () => {
  const res = await get(`/operators/${OP}/rental-terms`) // enforced=false in this test's wiring
  expect(await res.json()).toMatchObject({ success: true, data: null })
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `bun run --filter @kuruma/api test -- tests/routes/operators-terms-public.test.ts` → FAIL (route not mounted).

- [ ] **Step 3: Create the route**

`packages/api/src/routes/operators-terms-public.ts` (mirror `routes/consent.ts`'s locale parsing + `ok`/`fail` helpers). It requires an authenticated user (renter), reads via the injected consent read methods, and returns `null` when enforcement is off:
```typescript
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { ok } from './helpers'

export function operatorsTermsPublicRoutes(deps: {
  isOperatorTermsEnforced: () => boolean | Promise<boolean>
  findLatestPublishedVersionForOperator: (operatorId: string, type: 'OPERATOR_RENTAL_TERMS', now: Date) => Promise<string | undefined>
  findPublishedOperatorDocument: (operatorId: string, type: 'OPERATOR_RENTAL_TERMS', version: string, locale: string) => Promise<{ version: string; locale: string; title: string; body: string; acceptanceLabel: string } | undefined>
}) {
  return new Hono().use(requireAuth()).get('/operators/:operatorId/rental-terms', async (c) => {
    if (!(await deps.isOperatorTermsEnforced())) return ok(c, null)
    const operatorId = c.req.param('operatorId')
    const locale = presentationLocale(c) // reuse the ['en','ja','zh'].catch('en') parser from routes/consent.ts (extract to a shared helper)
    const now = new Date()
    const version = await deps.findLatestPublishedVersionForOperator(operatorId, 'OPERATOR_RENTAL_TERMS', now)
    if (!version) return ok(c, null)
    const doc =
      (await deps.findPublishedOperatorDocument(operatorId, 'OPERATOR_RENTAL_TERMS', version, locale)) ??
      (await deps.findPublishedOperatorDocument(operatorId, 'OPERATOR_RENTAL_TERMS', version, 'en'))
    return ok(c, doc ? { version: doc.version, locale: doc.locale, title: doc.title, body: doc.body, acceptanceLabel: doc.acceptanceLabel } : null)
  })
}
```
Extract `presentationLocale` from `routes/consent.ts` into a small shared route helper (e.g. `routes/locale.ts`) and import it in both.

- [ ] **Step 4: Mount + wire in `index.ts`**

Mount under a renter-reachable prefix (NOT `/admin/*`). Pass the `consentRepo` read methods + `isOperatorTermsEnforced`.

- [ ] **Step 5: Run — verify green; commit**

Run: `bun run --filter @kuruma/api test -- tests/routes/operators-terms-public.test.ts` → PASS.
```bash
bunx biome check --write packages/api/src/routes/operators-terms-public.ts packages/api/src/routes/consent.ts packages/api/src/index.ts packages/api/tests/routes/operators-terms-public.test.ts
git add packages/api/src/routes/operators-terms-public.ts packages/api/src/routes/consent.ts packages/api/src/routes/locale.ts packages/api/src/index.ts packages/api/tests/routes/operators-terms-public.test.ts
git commit -m "feat(#877): renter read endpoint for an operator's published rental terms"
```

---

## Task 8: Web modal-on-Reserve (checkout UX)

Fetch the operator's published terms; if present, clicking Reserve opens a modal with the terms + agree control; agreeing submits the booking with the pinned version + locale. No terms → Reserve submits directly. Handle a `422 OPERATOR_TERMS_CHANGED` by refetching + re-showing.

**Files:**
- Modify: `packages/web/src/vite/operator-terms/api.ts` (renter fetch + query options)
- Create: `packages/web/src/vite/reservation/OperatorTermsModal.tsx`
- Modify: `packages/web/src/vite/reservation/PaymentStep.tsx` (modal-on-Reserve + 422 handling; accept `operatorId`)
- Modify: the reservation route/wizard to pass `operatorId` to `PaymentStep`
- Modify: `packages/web/messages/{en,ja,zh}.json` (`reservation.operatorTerms.*`)
- Test: `packages/web/src/vite/reservation/PaymentStep.test.tsx` (or a new modal test)

- [ ] **Step 1: Add the renter fetch to the web api**

`packages/web/src/vite/operator-terms/api.ts`:
```typescript
export interface RenterOperatorTerms {
  version: string; locale: string; title: string; body: string; acceptanceLabel: string
}
export async function fetchRenterOperatorTerms(operatorId: string, locale: string): Promise<RenterOperatorTerms | null> {
  const res = await fetch(`${getApiBaseUrl()}/operators/${operatorId}/rental-terms?locale=${locale}`, { credentials: 'include' })
  if (!res.ok) return null
  const body = await res.json()
  return (body?.data ?? null) as RenterOperatorTerms | null
}
export function renterOperatorTermsQueryOptions(operatorId: string, locale: string) {
  return queryOptions({
    queryKey: ['renter-operator-terms', operatorId, locale],
    queryFn: () => fetchRenterOperatorTerms(operatorId, locale),
    staleTime: 60_000,
  })
}
```

- [ ] **Step 2: Write the failing component test**

`packages/web/src/vite/reservation/PaymentStep.test.tsx` — with a query seeded to return terms:
```typescript
it('opens the terms modal on Reserve and only submits after the renter agrees, pinning the version', async () => {
  // seed renterOperatorTermsQueryOptions -> { version: 'v2', locale: 'en', title, body, acceptanceLabel }
  renderPaymentStep({ operatorId: OP })
  await user.click(screen.getByRole('button', { name: /reserve|submit/i }))
  expect(createBookingMock).not.toHaveBeenCalled()          // modal, not submit
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: /agree/i }))
  await user.click(screen.getByRole('button', { name: /agree|confirm/i }))
  expect(createBookingMock).toHaveBeenCalledWith(
    expect.objectContaining({ operatorRentalTermsAcceptedVersion: 'v2', locale: 'en' }),
    expect.any(String),
  )
})
it('submits directly (no modal) when the operator has no published terms', async () => {
  // seed the query -> null
  renderPaymentStep({ operatorId: OP })
  await user.click(screen.getByRole('button', { name: /reserve|submit/i }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(createBookingMock).toHaveBeenCalled()
})
```

- [ ] **Step 3: Run — verify it fails**

Run: `bun run --filter @kuruma/web test -- src/vite/reservation/PaymentStep.test.tsx` → FAIL.

- [ ] **Step 4: Create the modal**

`packages/web/src/vite/reservation/OperatorTermsModal.tsx` (mirror `vite/operator-fees/AddFeeDialog.tsx` for the Dialog primitives):
```typescript
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import type { RenterOperatorTerms } from '@/vite/operator-terms/api'

export function OperatorTermsModal({ open, onOpenChange, terms, onAgree, pending }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  terms: RenterOperatorTerms
  onAgree: () => void
  pending: boolean
}) {
  const t = useTranslations('reservation.operatorTerms')
  const [agreed, setAgreed] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{terms.title}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{terms.body}</div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-input" />
          <span>{terms.acceptanceLabel}</span>
        </label>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>{t('cancel')}</Button>
          <Button type="button" onClick={onAgree} disabled={!agreed || pending}>{pending ? t('submitting') : t('agree')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Wire modal-on-Reserve into PaymentStep**

Add an `operatorId: string` prop. Use `useQuery(renterOperatorTermsQueryOptions(operatorId, locale))`. Replace the direct `mutation.mutate()` on Reserve with: if terms exist and not yet agreed → open the modal; the modal's `onAgree` sets the pin (`operatorRentalTermsAcceptedVersion: terms.version, locale`) and calls the mutation. On a `422` with `OPERATOR_TERMS_CHANGED`, invalidate the terms query, reopen the modal with the refreshed terms, and show `t('operatorTerms.changed')`. Keep the existing liability disclaimer checkbox unchanged (it stays inline). Gate the whole terms path behind `useFeatureFlag('OPERATOR_TERMS')` so it stays dark.

- [ ] **Step 6: Add i18n keys (zero-drift across en/ja/zh)**

`packages/web/messages/{en,ja,zh}.json` — add under `reservation`:
```json
"operatorTerms": {
  "subtitle": "Review and accept this operator's rental terms to continue.",
  "agree": "Agree and reserve",
  "cancel": "Cancel",
  "submitting": "Reserving…",
  "changed": "The operator updated their rental terms. Please review the new version."
}
```
(Provide real ja/zh translations, matching the Slice-A `business.terms` translation quality. The i18n parity lint requires identical key trees across the three files.)

- [ ] **Step 7: Thread `operatorId` from the route**

In the reservation route (`new.tsx`) / `ReservationWizard.tsx`, pass the known operator id (`storefront.operatorId` for SPECIFIC, `subject.offering.location.operatorId` for CLASS_COMBO) down to `PaymentStep`.

- [ ] **Step 8: Run web tests + typecheck; verify build regenerates route tree**

Run: `bun run --filter @kuruma/web test -- src/vite/reservation` → PASS.
Run: `bun run --filter @kuruma/web typecheck` → 0. If a route file changed, `cd packages/web && bunx vite build` to regenerate `routeTree.gen.ts` (commit it).

- [ ] **Step 9: Commit**

```bash
bunx biome check --write packages/web/src/vite/operator-terms/api.ts packages/web/src/vite/reservation/OperatorTermsModal.tsx packages/web/src/vite/reservation/PaymentStep.tsx packages/web/src/vite/reservation/PaymentStep.test.tsx packages/web/messages/en.json packages/web/messages/ja.json packages/web/messages/zh.json
git add packages/web/src/vite/operator-terms/api.ts packages/web/src/vite/reservation packages/web/messages
git commit -m "feat(#877): renter operator-terms modal on Reserve (dark behind VITE_FEATURE_OPERATOR_TERMS)"
```

---

## Task 9: Deploy presence check + final full-gate verification

**Files:**
- Modify: `.github/workflows/deploy.yml:102` (add `CONSENT_SIGNING_KEY`)

- [ ] **Step 1: Add the secret to the presence check**

`.github/workflows/deploy.yml` — the `for key in ...` list (~L102): append `CONSENT_SIGNING_KEY`:
```yaml
for key in DATABASE_URL AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET AUTH_URL GOOGLE_TRANSLATE_API_KEY CONSENT_SIGNING_KEY; do
```
Confirm `CONSENT_SIGNING_KEY` is set as a GitHub Secret + wired in `rotate-secrets.yml` (per the existing gotcha it should already be for Phase-2 ToS). If not, note it in the PR for the owner to add BEFORE merge (a missing secret would fail the deploy presence check).

- [ ] **Step 2: Run the full gate**

```bash
bun run --filter @kuruma/shared typecheck
bun run --filter @kuruma/api typecheck && bun run --filter @kuruma/web typecheck
bun run --filter @kuruma/api lint:boundaries
bun run lint:modules
bun run --filter @kuruma/shared test
bun run --filter @kuruma/api test                 # NO DATABASE_URL
DATABASE_URL=... bun run --filter @kuruma/api test:integration
bun run --filter @kuruma/web test
bun run db:verify                                  # 5/5
```
Expected: all green; `db:verify` 5/5.

- [ ] **Step 3: Commit + open PR**

```bash
git add .github/workflows/deploy.yml
git commit -m "chore(#877): add CONSENT_SIGNING_KEY to the deploy presence check"
```
Open PR (base `develop`), body `Refs #877` (NOT Closes — epic stays open). Grep the whole PR body for `Clos|Fix|Resolv` before creating, and verify `closingIssuesReferences == []`. Land with NO force-push (see the `feedback_no-force-push-merge-technique` memory): strict up-to-date + manual merge race, squash NOT `--admin`.

---

## Self-Review (checked against spec §14)

- **C1 (version pin):** Task 5 (request field) + Task 6 steps 5 (pin-verify → 422 CHANGED/REQUIRED) + Task 8 (client pins `terms.version`). ✓
- **H1 (server flag):** Task 4 (flag + gate publish) + Task 6 (gate require) + Task 7 (read returns null when off). ✓
- **H2 (self-serve only):** Task 6 step 5 (`source==='DIRECT' && !walkInCustomer`) + test for MANUAL skip. ✓
- **H3 (sign outside tx):** Task 6 step 2 (resolve key in `create()` before `runInTransaction`), insert inside. Deploy check Task 9. ✓
- **M1 (locale):** Task 5 (`locale` field) threaded to `findPublishedOperatorDocument` in Task 6. ✓
- **M2 (one assembler):** Task 2 `buildSignedAcceptance`, consumed by `ConsentService` (Task 2) + booking path (Task 6). ✓
- **M3 (total shape):** Task 2 `expectedSubjectShape` + accept-reject test. ✓
- **M4 (Pick<> + optional ctor):** Task 3. ✓
- **L1 (rename seal):** Task 1 `consent_unique_booking_type`. ✓
- **Schema (seal + CHECK):** Task 1. **operatorId stays NULL:** Task 6 step 5 passes `operatorId: null`. ✓
- **Idempotency/replay:** the generalized `(bookingId, consentType)` seal + the pre-tx idempotency short-circuit in `create()` (a retried idempotencyKey returns the existing booking before the tx) mean no double-seal; no extra in-tx pre-check needed (L3). ✓
- **Dark:** `OPERATOR_TERMS_ENFORCEMENT` OFF + `VITE_FEATURE_OPERATOR_TERMS` OFF; no flips. ✓

**Placeholder scan:** the two spots that say "mirror the existing harness" (Task 1 Step 10, Task 6 Step 3 fixtures) refer to concrete existing files — the implementer reads that file's factories rather than inventing them; this is a reuse instruction, not a TODO. No `TBD`/`add validation`/unshown code.

**Type consistency:** `buildSignedAcceptance(doc, subject, key)` signature is identical in Tasks 2 and 6. `findBookingAcceptance(bookingId, consentType)` identical in Tasks 1, 6, 8-test. `isOperatorTermsEnforced: () => boolean | Promise<boolean>` identical across Tasks 4, 6, 7. Flag key `OPERATOR_TERMS_ENFORCEMENT` identical across Tasks 4, 6, 7.

---

## Open decision for the owner (flagged, not blocking plan structure)

**H1 flag shape.** This plan adds a NEW `serverOnly` flag `OPERATOR_TERMS_ENFORCEMENT` (additive; Slice A's `VITE_FEATURE_OPERATOR_TERMS` web flag untouched; GA flips both). The alternative is to CONVERT the existing `OPERATOR_TERMS` flag to `serverOnly` so there's one flag for both web + server — cleaner long-term but it touches Slice A's web-flag readers, nav gating, route guard, and Slice-A tests (regression surface). Recommendation: ship the additive flag now (this plan); consolidate to one flag as a GA-time follow-up if desired.
