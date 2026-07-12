# Operator Usage Consent — Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The renter accepts an operator's published `OPERATOR_RENTAL_TERMS` consent doc atomically at booking-create — version-pinned, signed, one ledger row per booking — behind two OFF flags.

**Architecture:** Functional Core / Imperative Shell. Outside the booking tx: resolve the operator's published+effective doc in the renter locale, compare the client-pinned version, resolve+validate the signing key (all fail-fast). Inside the existing booking tx: re-read latest version (close the residual race), insert the booking (yields `bookingId`), HMAC-sign the now-complete field set, insert the acceptance row. Reads for the modal go through a new renter-safe `GET /operator-terms/published`. Everything gated by a server thunk `isOperatorTermsEnabled` (API) + `VITE_FEATURE_OPERATOR_TERMS` (web).

**Tech Stack:** TypeScript (strict), Hono (API routes), Drizzle + Postgres (drizzle-kit migrations in `/drizzle`), Vitest + real-pg integration tests, React + TanStack Query + use-intl (web), Bun.

**Design source:** `docs/superpowers/specs/2026-07-09-operator-usage-consent-slice-b-addendum.md` (approved; read §2 decisions, §3 must-fixes, §9b planning deltas). This plan is the concrete realization; where they differ, §9b already reconciled it.

**Plan review round (2026-07-09) — 5 fixes applied, all verified vs `origin/develop`:**
- **DI + in-tx resolution:** `BookingService` (built at `index.ts:417`) has NO consentRepo/signing/flag today, and `operatorId` is resolved INSIDE `submitInTx`. So: inject two thunks (`getSigningKey`, `isOperatorTermsEnabled`) into `BookingService`; resolve the signing KEY outside the tx (fail-fast, needs no operatorId); resolve the DOC + pin-check INSIDE `submitInTx` after the anchor read. This makes C1's residual-race re-read unnecessary — the single in-tx resolve is authoritative (see §9b delta 8 in the addendum). Tasks 9–11.
- **Flag from the start:** the server dark flag gates BOTH the `GET /operator-terms/published` endpoint (404 when off) and the booking require-branch, from Tasks 8/11 — not bolted on in Task 17. Source: `FeatureFlagsService.isEnabled('OPERATOR_TERMS')` (mirror the existing `isSharedCatalogEnabled` thunk).
- **Shared validator:** the create schema is `packages/shared/src/validators/booking.ts` `createBookingSchema` — Zod strips unknown keys, so the new fields MUST be added there (Task 10), not just in `routes/bookings.ts`.
- **Test isolation:** real-pg acceptance tests seed a FRESH booking per test (the suite keeps rows until `afterAll`; reusing one `bookingId` cross-pollutes) — Tasks 2/11.
- **Web import path:** `getApiBaseUrl` is imported from `@/vite/api-base` (not `@/lib/api-base`) — Task 13.

**Conventions for every task:** work in the worktree `../kuruma-consent-sliceb` on branch `feat/consent-slice-b` (created in Task 0). Run API tests from `packages/api`; web from `packages/web`; shared from `packages/shared`. Commit after each GREEN. Never force-push (husky blocks). `OPERATOR_RENTAL_TERMS`, `RENTER_LIABILITY`, `CLICKWRAP`, `OPERATOR_TERMS_REQUIRED`, `OPERATOR_TERMS_CHANGED` are the exact string literals — do not vary casing.

---

## File Structure

**Shared (`packages/shared/src`)**
- Modify `db/consent.ts` — generalize the booking seal + widen the CHECK (rename both to `_booking_type`).
- Modify `lib/error-codes.ts` — append `OPERATOR_TERMS_REQUIRED`, `OPERATOR_TERMS_CHANGED`.
- Modify `lib/error-codes.test.ts` — pin the two new codes.

**Migration (`/drizzle`)**
- Create `0107_consent_booking_type_seal.sql` (+ generated `meta/0107_snapshot.json`, `_journal.json` entry).

**API (`packages/api/src`)**
- Create `services/consent-acceptance-row.ts` — pure `buildAcceptanceRow(doc, subject, signingKey)` (extracted from `services/consent.ts`).
- Modify `services/consent.ts` — delegate `buildRow` to the shared helper; total shape-check; reject `OPERATOR_RENTAL_TERMS` on the accept path.
- Modify `repositories/types-consent.ts` — `findBookingAcceptance(bookingId, consentType)`.
- Modify `repositories/drizzle/consent.ts` + `repositories/in-memory/consent.ts` — the new arg; `assertUnique` keyed on `(bookingId, consentType)`; new seal name.
- Modify `services/operator-terms.ts` — `getPublished(operatorId, locale, now)` renter resolver.
- Modify `routes/operator-terms.ts` — `GET /operator-terms/published` (`requireAuth` only).
- Modify `repositories/types-transactions.ts` — add narrowed `consentRepo`.
- Modify `repositories/drizzle/transaction.ts` + `composition/repositories.ts` (both in-memory builders) — construct the tx-bound consent repo.
- Modify `services/booking-types.ts` — `operatorRentalTermsAccepted`, `operatorRentalTermsAcceptedVersion`, `locale` on `CreateBookingCommon`.
- Modify `services/booking-creation.ts` — resolve/pin/sign outside tx; write acceptance inside tx.
- Modify `routes/bookings.ts` — parse + forward the three new fields; launder the new codes.
- Create `tests/integration/consent-operator-terms-booking.test.ts` — real-pg end-to-end acceptance write.

**Web (`packages/web/src`)**
- Modify `vite/bookings/api.ts` — send the three new fields.
- Create `vite/operator-terms/publishedApi.ts` — renter fetch of the published doc.
- Modify `routes/$locale/_renter/bookings/new.tsx` → `vite/reservation/ReservationWizard.tsx` → `vite/reservation/PaymentStep.tsx` — thread `operatorId`; modal-on-Reserve; handle the two 422 codes.
- Create `vite/reservation/OperatorTermsModal.tsx` — scrollable terms + agree.

---

## Task 0: Worktree + baseline green

**Files:** none (setup).

- [ ] **Step 1: Create the worktree off fresh develop**

```bash
cd /Users/jack/dev/kuruma-rental
git fetch origin
git worktree add ../kuruma-consent-sliceb -b feat/consent-slice-b origin/develop
cd ../kuruma-consent-sliceb
cp ../kuruma-rental/docs/superpowers/specs/2026-07-09-operator-usage-consent-slice-b-addendum.md docs/superpowers/specs/ 2>/dev/null || true
cp ../kuruma-rental/docs/superpowers/plans/2026-07-09-operator-usage-consent-slice-b.md docs/superpowers/plans/ 2>/dev/null || true
```

- [ ] **Step 2: Install + confirm baseline is green**

Run: `bun install && cd packages/api && bun test tests/integration/consent-records.test.ts`
Expected: PASS (this is the seal test we will edit in Task 2).

- [ ] **Step 3: Commit the design docs**

```bash
git add docs/superpowers/specs/2026-07-09-operator-usage-consent-slice-b-addendum.md docs/superpowers/plans/2026-07-09-operator-usage-consent-slice-b.md
git commit -m "docs: operator-terms slice B design addendum + implementation plan"
```

---

## Slice 1 — Error codes (shared)

Do this first: both the API emit sites and the web comparisons need these to typecheck.

## Task 1: Add `OPERATOR_TERMS_REQUIRED` / `OPERATOR_TERMS_CHANGED`

**Files:**
- Modify: `packages/shared/src/lib/error-codes.ts`
- Test: `packages/shared/src/lib/error-codes.test.ts`

- [ ] **Step 1: Update the pinning test (RED)**

In `error-codes.test.ts`, add both codes to the sorted exact-equality array (`:13-40`). Insert alphabetically:

```ts
      'NOT_IMPLEMENTED',
      'NO_COMBO_RATE_SET',
      'NO_RATES_SET',
      'OPERATOR_DEACTIVATED',
      'OPERATOR_REQUIRED',
      'OPERATOR_TERMS_CHANGED',
      'OPERATOR_TERMS_REQUIRED',
      'RENTAL_RULE_ADVANCE_BOOKING',
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/shared && bun test src/lib/error-codes.test.ts`
Expected: FAIL — `ERROR_CODES` missing the two codes.

- [ ] **Step 3: Add the codes (GREEN)**

In `error-codes.ts`, append inside the `ERROR_CODES` array (before `] as const`):

```ts
  // #877 Slice B: renter must accept the operator's published rental terms at
  // booking-create. REQUIRED — a published doc exists but the accept flag is
  // missing/false; CHANGED — the client-pinned version != latest at submit
  // (the operator republished mid-checkout). Laundered onto the booking-create
  // envelope via CreateBookingResult.code.
  'OPERATOR_TERMS_REQUIRED',
  'OPERATOR_TERMS_CHANGED',
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/shared && bun test src/lib/error-codes.test.ts`
Expected: PASS (both the exact-set and no-duplicates tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lib/error-codes.ts packages/shared/src/lib/error-codes.test.ts
git commit -m "feat(#877): add OPERATOR_TERMS_REQUIRED/CHANGED error codes"
```

---

## Slice 2 — Schema seal (migration + drizzle + real-pg test)

## Task 2: Generalize the booking seal to `(bookingId, consentType)`

**Files:**
- Modify: `packages/shared/src/db/consent.ts:97-113`
- Test: `packages/api/tests/integration/consent-records.test.ts`
- Create: `/drizzle/0107_consent_booking_type_seal.sql` (+ generated meta)

- [ ] **Step 1: Add the RED real-pg test — a second, DIFFERENT type coexists on one booking**

In `consent-records.test.ts`, add a test that today would fail (the old unique is on `bookingId` alone, so a 2nd row on the same booking is rejected regardless of type). It must PASS after the seal is generalized. Use the existing `insertAcceptance`/`acceptance` helpers and the seeded `bookingId`. You will also need a seeded `OPERATOR_RENTAL_TERMS` document id — extend the `beforeAll` doc seeding to insert one (operatorId set on the doc, per Slice A) and record `docIds.OPERATOR_RENTAL_TERMS`.

```ts
  it('allows RENTER_LIABILITY and OPERATOR_RENTAL_TERMS to coexist on one booking', async () => {
    const liability = acceptance({
      consentType: 'RENTER_LIABILITY',
      documentId: docIds.RENTER_LIABILITY!,
      bookingId,
    })
    expect(await insertAcceptance(liability), 'liability row must insert').toBeNull()

    const operatorTerms = acceptance({
      consentType: 'OPERATOR_RENTAL_TERMS',
      documentId: docIds.OPERATOR_RENTAL_TERMS!,
      bookingId,
      operatorId: null, // architect decision: operatorId stays NULL on the acceptance
    })
    expect(await insertAcceptance(operatorTerms), 'operator-terms row must insert').toBeNull()
  })

  it('rejects a second OPERATOR_RENTAL_TERMS acceptance for the same booking (booking-type unique)', async () => {
    await expectViolation(
      acceptance({
        consentType: 'OPERATOR_RENTAL_TERMS',
        documentId: docIds.OPERATOR_RENTAL_TERMS!,
        bookingId,
        operatorId: null,
      }),
      PG_ERROR.UNIQUE_VIOLATION,
      'consent_unique_booking_type',
    )
  })
```

Also update the two EXISTING literal assertions of the old names in this file: `'consent_unique_booking_liability'` → `'consent_unique_booking_type'` (the duplicate-liability test) and `'consent_liability_booking_chk'` → `'consent_booking_type_chk'` (the null-bookingId CHECK test).

**Test isolation (P2-4):** this suite keeps acceptance rows until `afterAll`, so tests that write to the shared seeded `bookingId` cross-pollute by order (the coexistence test leaves a liability + operator-terms row that the duplicate/same-type tests then collide with unpredictably). Fix: seed a FRESH booking per test — add `let bookingId: string; beforeEach(async () => { bookingId = (await createSeededBooking(db, seed)).id })` (mirror the existing `createSeededBooking` from `./booking-factory`) — OR add `afterEach(async () => { await db.delete(consentAcceptances).where(eq(consentAcceptances.bookingId, bookingId)) })`. Prefer the fresh-booking-per-test form.

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test tests/integration/consent-records.test.ts`
Expected: FAIL — the coexistence test hits `consent_unique_booking_liability` (old unique on bookingId alone), and the renamed-constraint assertions don't match yet.

- [ ] **Step 3: Edit the drizzle schema (GREEN part A)**

In `packages/shared/src/db/consent.ts`, replace the CHECK (`:97-100`) and the unique index (`:111-113`):

```ts
    check(
      'consent_booking_type_chk',
      sql`(${t.consentType} IN ('RENTER_LIABILITY','OPERATOR_RENTAL_TERMS')) = (${t.bookingId} IS NOT NULL)`,
    ),
```

```ts
    uniqueIndex('consent_unique_booking_type')
      .on(t.bookingId, t.consentType)
      .where(sql`${t.bookingId} IS NOT NULL`),
```

- [ ] **Step 4: Generate the migration (GREEN part B)**

Run: `cd /Users/jack/dev/kuruma-rental/../kuruma-consent-sliceb && bun run db:generate`
Then inspect the emitted `/drizzle/0107_*.sql`. It MUST express exactly these four operations (rename the file to `0107_consent_booking_type_seal.sql` if drizzle named it generically, and keep the generated `meta/0107_snapshot.json` + `_journal.json` entry):

```sql
DROP INDEX "consent_unique_booking_liability";--> statement-breakpoint
CREATE UNIQUE INDEX "consent_unique_booking_type" ON "consent_acceptances" USING btree ("bookingId","consentType") WHERE "consent_acceptances"."bookingId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_acceptances" DROP CONSTRAINT "consent_liability_booking_chk";--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_booking_type_chk" CHECK (("consent_acceptances"."consentType" IN ('RENTER_LIABILITY','OPERATOR_RENTAL_TERMS')) = ("consent_acceptances"."bookingId" IS NOT NULL));
```

If drizzle-kit omits the partial-index `WHERE` or the CHECK body, hand-patch the SQL to match the block above (the snapshot json still reflects the schema, which is what matters for future diffs).

- [ ] **Step 5: Apply + run the real-pg test — expect GREEN**

Run: `cd packages/api && bun run db:migrate && bun test tests/integration/consent-records.test.ts`
Expected: PASS — coexistence inserts; second same-type row → 23505 `consent_unique_booking_type`; null-bookingId liability → 23514 `consent_booking_type_chk`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/db/consent.ts drizzle/ packages/api/tests/integration/consent-records.test.ts
git commit -m "feat(#877): generalize booking consent seal to (bookingId, consentType)"
```

---

## Task 3: In-memory `assertUnique` parity + seal name

**Files:**
- Modify: `packages/api/src/repositories/in-memory/consent.ts:250-279`
- Test: `packages/api/src/repositories/in-memory/consent.test.ts`

- [ ] **Step 1: RED — in-memory must allow two types per booking but reject same-type dup**

In `in-memory/consent.test.ts`, add:

```ts
it('allows two different consent types on one booking, rejects same-type dup', async () => {
  const repo = new InMemoryConsentRepository(seededDocs)
  const base = { userId: 'u1', bookingId: 'b1', operatorId: null } // fill via existing test factory
  await repo.createAcceptance(newAcceptance({ ...base, consentType: 'RENTER_LIABILITY', documentId: 'd-liab' }))
  await expect(
    repo.createAcceptance(newAcceptance({ ...base, consentType: 'OPERATOR_RENTAL_TERMS', documentId: 'd-terms' })),
  ).resolves.toBeDefined()
  await expect(
    repo.createAcceptance(newAcceptance({ ...base, consentType: 'OPERATOR_RENTAL_TERMS', documentId: 'd-terms' })),
  ).rejects.toMatchObject({ constraint_name: 'consent_unique_booking_type' })
})
```

Update the existing test that asserts `constraint_name: 'consent_unique_booking_liability'` → `'consent_unique_booking_type'`.

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/repositories/in-memory/consent.test.ts`
Expected: FAIL — the second (different-type) row throws under the old `bookingId`-only rule; name mismatch.

- [ ] **Step 3: GREEN — key the early-return on `(bookingId, consentType)`**

In `in-memory/consent.ts`, replace the `bookingId` branch of `assertUnique` and fix the comment (L2):

```ts
  // The DB seals: consent_booking_type_chk makes bookingId≠null iff the type is
  // RENTER_LIABILITY or OPERATOR_RENTAL_TERMS, and consent_unique_booking_type is
  // unique on (bookingId, consentType) — so one booking may carry at most one row
  // of EACH booking-scoped type. This double mirrors that; it does not re-enforce
  // the CHECKs (callers construct shape-valid rows; ConsentService is the guard).
  private assertUnique(d: NewConsentAcceptance): void {
    if (d.bookingId !== null) {
      if (this.acceptances.some((a) => a.bookingId === d.bookingId && a.consentType === d.consentType))
        throw uniqueViolation('consent_unique_booking_type')
      return
    }
```

(Leave the `operatorId` and user-document branches unchanged.)

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/repositories/in-memory/consent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/in-memory/consent.ts packages/api/src/repositories/in-memory/consent.test.ts
git commit -m "feat(#877): in-memory consent uniqueness keyed on (bookingId, consentType)"
```

---

## Task 4: `findBookingAcceptance(bookingId, consentType)`

**Files:**
- Modify: `packages/api/src/repositories/types-consent.ts:89`
- Modify: `packages/api/src/repositories/drizzle/consent.ts:152-159`, `in-memory/consent.ts:78-80`
- Modify caller: `packages/api/src/services/consent.ts:219-229` (`findExisting`)
- Test: `packages/api/src/repositories/in-memory/consent.test.ts`

- [ ] **Step 1: RED — the same booking yields the row for the requested type only**

```ts
it('findBookingAcceptance disambiguates by consentType', async () => {
  const repo = new InMemoryConsentRepository(seededDocs)
  await repo.createAcceptance(newAcceptance({ userId: 'u1', bookingId: 'b1', operatorId: null, consentType: 'OPERATOR_RENTAL_TERMS', documentId: 'd-terms' }))
  expect(await repo.findBookingAcceptance('b1', 'OPERATOR_RENTAL_TERMS')).toBeDefined()
  expect(await repo.findBookingAcceptance('b1', 'RENTER_LIABILITY')).toBeUndefined()
})
```

- [ ] **Step 2: Run — expect RED (type error / wrong arity)**

Run: `cd packages/api && bun test src/repositories/in-memory/consent.test.ts`
Expected: FAIL — `findBookingAcceptance` takes one arg.

- [ ] **Step 3: GREEN — add the arg across interface + both impls + caller**

`types-consent.ts:89`:
```ts
  findBookingAcceptance(
    bookingId: string,
    consentType: ConsentType,
  ): Promise<ConsentAcceptance | undefined>
```

`drizzle/consent.ts`:
```ts
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
(Add `and` to the drizzle imports if absent.)

`in-memory/consent.ts`:
```ts
async findBookingAcceptance(
  bookingId: string,
  consentType: ConsentType,
): Promise<ConsentAcceptance | undefined> {
  return this.acceptances.find((a) => a.bookingId === bookingId && a.consentType === consentType)
}
```

`services/consent.ts` `findExisting` — the `bookingId !== null` branch now passes `doc.type`:
```ts
    if (bookingId !== null) return this.repo.findBookingAcceptance(bookingId, type)
```
(Confirm `findExisting` has `type` in scope; it receives `doc.type` as its first param today — thread it if needed.)

- [ ] **Step 4: Run — expect GREEN (repo + service unit suites)**

Run: `cd packages/api && bun test src/repositories/in-memory/consent.test.ts src/services/consent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/types-consent.ts packages/api/src/repositories/drizzle/consent.ts packages/api/src/repositories/in-memory/consent.ts packages/api/src/services/consent.ts packages/api/src/repositories/in-memory/consent.test.ts
git commit -m "feat(#877): findBookingAcceptance disambiguated by consentType"
```

---

## Slice 3 — Consent service: shared row builder, total shape-check, reject on accept path

## Task 5: Extract the pure `buildAcceptanceRow` helper

**Files:**
- Create: `packages/api/src/services/consent-acceptance-row.ts`
- Modify: `packages/api/src/services/consent.ts` (delegate `buildRow`)
- Test: `packages/api/src/services/consent-acceptance-row.test.ts`

- [ ] **Step 1: RED — the helper builds a signed row with the doc snapshot**

```ts
import { describe, expect, it } from 'vitest'
import { buildAcceptanceRow } from './consent-acceptance-row'

const doc = { id: 'd1', type: 'OPERATOR_RENTAL_TERMS' as const, version: 'v3', locale: 'ja',
  title: 'T', body: 'B', acceptanceLabel: 'A', contentHash: 'h' }
const subject = { userId: 'u1', operatorId: null, operatorMembershipId: null, actorRole: 'RENTER',
  bookingId: 'b1', method: 'CLICKWRAP' as const, acceptedAt: new Date('2026-07-09T00:00:00Z'),
  ipAddress: null, userAgent: null }

it('builds a signed row carrying the document snapshot and bookingId', () => {
  const row = buildAcceptanceRow(doc, subject, { key: 'secret', keyId: 'v1' })
  expect(row.documentSnapshot).toEqual({ version: 'v3', locale: 'ja', title: 'T', body: 'B', acceptanceLabel: 'A', contentHash: 'h' })
  expect(row.bookingId).toBe('b1')
  expect(row.consentType).toBe('OPERATOR_RENTAL_TERMS')
  expect(row.recordSignature).toMatch(/^[0-9a-f]{64}$/)
  expect(row.signingKeyId).toBe('v1')
  expect(row.signatureCanonicalVersion).toBe('v1')
})

it('omits the signature when no key is supplied', () => {
  const row = buildAcceptanceRow(doc, subject, undefined)
  expect(row.recordSignature).toBeNull()
  expect(row.signingKeyId).toBeNull()
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/services/consent-acceptance-row.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: GREEN — implement the helper (lifted verbatim from `consent.ts` buildRow)**

```ts
import { CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentMethod, ConsentType } from '@kuruma/shared/enums'
import type { NewConsentAcceptance } from '../repositories/types-consent'
import { type SigningKey, signAcceptanceRecord } from './consent-signing'

export interface AcceptanceDoc {
  id: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
}

export interface AcceptanceSubject {
  userId: string
  operatorId: string | null
  operatorMembershipId: string | null
  actorRole: string | null
  bookingId: string | null
  method: ConsentMethod
  acceptedAt: Date
  ipAddress: string | null
  userAgent: string | null
}

/** Pure: HMAC-signs the canonical field set and packs the persisted row (spec §5). */
export function buildAcceptanceRow(
  doc: AcceptanceDoc,
  subject: AcceptanceSubject,
  signingKey: SigningKey | undefined,
): NewConsentAcceptance {
  const signed = signingKey
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
          method: subject.method,
          acceptedAt: subject.acceptedAt,
          ipAddress: subject.ipAddress,
          userAgent: subject.userAgent,
        },
        signingKey,
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
    method: subject.method,
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

- [ ] **Step 4: Delegate `consent.ts` `buildRow` to the helper**

Replace the body of the private `buildRow` in `services/consent.ts` with a call to `buildAcceptanceRow(doc, { userId: input.userId, operatorId, operatorMembershipId: input.operatorMembershipId ?? null, actorRole: input.actorRole, bookingId, method: 'CLICKWRAP', acceptedAt: meta.now, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null }, this.getSigningKey())`.

- [ ] **Step 5: Run — expect GREEN (helper + service unchanged behavior)**

Run: `cd packages/api && bun test src/services/consent-acceptance-row.test.ts src/services/consent.test.ts`
Expected: PASS (existing consent service tests still green — behavior preserved).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/consent-acceptance-row.ts packages/api/src/services/consent-acceptance-row.test.ts packages/api/src/services/consent.ts
git commit -m "refactor(#877): extract pure buildAcceptanceRow shared by accept + booking paths"
```

---

## Task 6: Total shape-check + reject `OPERATOR_RENTAL_TERMS` on `/consent/accept`

**Files:**
- Modify: `packages/api/src/services/consent.ts:60-71`
- Test: `packages/api/src/services/consent.test.ts`

- [ ] **Step 1: RED — accept path rejects OPERATOR_RENTAL_TERMS; shape-check is total**

```ts
it('rejects OPERATOR_RENTAL_TERMS over the accept endpoint (booking-path only)', async () => {
  const { service, repo } = makeService() // existing test harness
  const docId = await seedPublishedDoc(repo, { type: 'OPERATOR_RENTAL_TERMS' })
  const result = await service.recordAcceptance(
    { documentId: docId, userId: 'u1', actorRole: 'RENTER' },
    { now: new Date() },
  )
  expect(result).toMatchObject({ ok: false, status: 400, error: 'OPERATOR_TERMS_NOT_SELF_MINTABLE' })
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/services/consent.test.ts`
Expected: FAIL — today it falls through to `SUBJECT_SHAPE_INVALID` or attempts a write.

- [ ] **Step 3: GREEN — reject + total shape-check**

In `recordAcceptance`, immediately after the `DOCUMENT_NOT_ACCEPTABLE` check and before the shape derivation, add:

```ts
    // OPERATOR_RENTAL_TERMS is minted ONLY inside the booking tx (§B). The
    // self-serve accept endpoint must never create one.
    if (doc.type === 'OPERATOR_RENTAL_TERMS')
      return { ok: false, status: 400, error: 'OPERATOR_TERMS_NOT_SELF_MINTABLE' }
```

Then make the shape-check total by keying required shape on cardinality, so a future booking-scoped type can't silently pass. Replace the derived-booleans block (`:68-71`) with:

```ts
    // Total: booking-scoped types (PER_EVENT) require a bookingId and NULL operator;
    // OPERATOR_AGREEMENT requires an operatorId; everything else is user-scoped.
    const requiresBooking = CONSENT_CARDINALITY[doc.type] === 'PER_EVENT'
    const requiresOperator = doc.type === 'OPERATOR_AGREEMENT'
    if (requiresBooking !== (bookingId !== null) || requiresOperator !== (operatorId !== null))
      return { ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' }
```

Add `import { CONSENT_CARDINALITY } from '@kuruma/shared/enums'` if absent.

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/services/consent.test.ts`
Expected: PASS (new rejection + all existing RENTER_LIABILITY / OPERATOR_AGREEMENT / user-doc cases).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/consent.ts packages/api/src/services/consent.test.ts
git commit -m "feat(#877): reject OPERATOR_RENTAL_TERMS on accept path; total subject-shape check"
```

---

## Slice 4 — Renter-safe published-terms read

## Task 7: `OperatorTermsService.getPublished` resolver

**Files:**
- Modify: `packages/api/src/services/operator-terms.ts`
- Test: `packages/api/src/services/operator-terms.test.ts`

- [ ] **Step 1: RED — returns the published+effective doc in locale, `en` fallback, none when absent**

```ts
it('getPublished resolves the latest published doc in the requested locale', async () => {
  const repo = new InMemoryConsentRepository(/* seed a PUBLISHED v2 ja + en */)
  const service = new OperatorTermsService(repo)
  const now = new Date('2026-07-09T00:00:00Z')
  const r = await service.getPublished('op1', 'ja', now)
  expect(r).toMatchObject({ ok: true, doc: { version: 'v2', locale: 'ja', title: expect.any(String) } })
})

it('getPublished falls back to en when the locale is missing', async () => {
  // seed only en for v2
  const r = await service.getPublished('op1', 'zh', now)
  expect(r).toMatchObject({ ok: true, doc: { version: 'v2', locale: 'en' } })
})

it('getPublished returns not-found when the operator has no published terms', async () => {
  const r = await service.getPublished('op-none', 'en', now)
  expect(r).toEqual({ ok: false, status: 404, error: 'NO_PUBLISHED_TERMS' })
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/services/operator-terms.test.ts`
Expected: FAIL — `getPublished` undefined.

- [ ] **Step 3: GREEN — implement using the repo resolvers**

Add to `OperatorTermsService`:

```ts
export interface PublishedOperatorTerms {
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
}
export type PublishedTermsResult =
  | { ok: true; doc: PublishedOperatorTerms }
  | { ok: false; status: number; error: string }

/** Renter-facing: the operator's latest PUBLISHED+effective terms in `locale`
 *  (fallback en). Never returns drafts/archived. */
async getPublished(operatorId: string, locale: string, now: Date): Promise<PublishedTermsResult> {
  const version = await this.repo.findLatestPublishedVersionForOperator(operatorId, TYPE, now)
  if (!version) return { ok: false, status: 404, error: 'NO_PUBLISHED_TERMS' }
  const doc =
    (await this.repo.findPublishedOperatorDocument(operatorId, TYPE, version, locale)) ??
    (await this.repo.findPublishedOperatorDocument(operatorId, TYPE, version, 'en'))
  if (!doc) return { ok: false, status: 404, error: 'NO_PUBLISHED_TERMS' }
  return {
    ok: true,
    doc: {
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

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/services/operator-terms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/operator-terms.ts packages/api/src/services/operator-terms.test.ts
git commit -m "feat(#877): OperatorTermsService.getPublished renter resolver"
```

---

## Task 8: `GET /operator-terms/published` route (renter auth only)

**Files:**
- Modify: `packages/api/src/routes/operator-terms.ts`
- Test: `packages/api/src/routes/operator-terms.test.ts` (or the routes test harness)

- [ ] **Step 1: RED — any authed user reads published terms; drafts never leak; 404 when absent**

```ts
it('GET /operator-terms/published returns the published doc for an authed renter', async () => {
  const res = await app.request(`/operator-terms/published?operatorId=op1&locale=ja`, {}, renterEnv)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data).toMatchObject({ version: 'v2', locale: 'ja', body: expect.any(String) })
})

it('GET /operator-terms/published 404s when the operator has no published terms', async () => {
  const res = await app.request(`/operator-terms/published?operatorId=op-none&locale=en`, {}, renterEnv)
  expect(res.status).toBe(404)
})

it('GET /operator-terms/published 404s when the OPERATOR_TERMS flag is OFF (dark)', async () => {
  const appFlagOff = makeOperatorTermsApp({ isOperatorTermsEnabled: async () => false })
  const res = await appFlagOff.request(`/operator-terms/published?operatorId=op1&locale=ja`, {}, renterEnv)
  expect(res.status).toBe(404) // published doc exists, but the feature is dark
})
```

(Build the app in the first two tests with `isOperatorTermsEnabled: async () => true`.)

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/routes/operator-terms.test.ts`
Expected: FAIL — 404 (route not registered) or wrong shape.

- [ ] **Step 3: GREEN — add the flag-gated handler (no `requireFleetWriteRole`)**

Add an `isOperatorTermsEnabled: () => Promise<boolean>` param to `createOperatorTermsRoutes(service, resolveWriteOperatorId, isOperatorTermsEnabled)` and inject it at `index.ts` (`() => featureFlagsService.isEnabled('OPERATOR_TERMS')`, mirroring the existing `isSharedCatalogEnabled` thunk — construct `featureFlagsService` before this route). In the chain, add a handler that only requires auth (the path-level `app.use('/operator-terms/*', requireAuth())` already covers it) and returns 404 when the flag is OFF so the read path is dark in lockstep with the accept path:

```ts
.get('/operator-terms/published', async (c) => {
  if (!(await isOperatorTermsEnabled())) return fail(c, 'Not found', 404) // dark: no oracle
  const operatorId = c.req.query('operatorId')
  if (!operatorId) return fail(c, 'operatorId is required', 400)
  const locale = presentationLocale(c) // z.enum(['en','ja','zh']).catch('en'), mirror routes/consent.ts
  const result = await service.getPublished(operatorId, locale, new Date())
  if (!result.ok) return fail(c, result.error, result.status)
  return ok(c, result.doc)
})
```

Do NOT call `requireFleetWriteRole` here — this is the one renter-readable operator-terms route. Import/duplicate the small `presentationLocale` helper (from `routes/consent.ts`) or read `c.req.query('locale')` through the same `z.enum(['en','ja','zh']).catch('en')`.

Note the flag-off test from Step 1 must pass: with the flag OFF, the endpoint 404s even for a published doc.

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/routes/operator-terms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/operator-terms.ts packages/api/src/routes/operator-terms.test.ts
git commit -m "feat(#877): renter-safe GET /operator-terms/published"
```

---

## Slice 5 — Tx wiring + atomic acceptance in `submitInTx`

## Task 9: Add narrowed `consentRepo` to the tx bundle

**Files:**
- Modify: `packages/api/src/repositories/types-transactions.ts`
- Modify: `packages/api/src/repositories/drizzle/transaction.ts`
- Modify: `packages/api/src/composition/repositories.ts` (both `buildInMemoryRepos` + `buildOverrideRepos`)

- [ ] **Step 1: Add the type (RED via tsc)**

In `types-transactions.ts`, add to `TransactionRepos`:

```ts
  // #877 Slice B: the renter's operator-terms acceptance is written INSIDE the
  // booking tx (one ledger row, atomic with the booking). Narrowed to the reads
  // the resolve+pin needs plus the write; none of these four use runTransaction,
  // so the tx-bound instance's sentinel runTx is never reached (M4).
  consentRepo: Pick<
    ConsentRepository,
    'findBookingAcceptance' | 'createAcceptance' | 'findLatestPublishedVersionForOperator' | 'findPublishedOperatorDocument'
  >
```

Add `import type { ConsentRepository } from './types-consent'` if absent.

- [ ] **Step 2: Run tsc — expect RED**

Run: `cd packages/api && bunx tsc --noEmit`
Expected: FAIL — the three composition sites don't supply `consentRepo`.

- [ ] **Step 3: GREEN — construct it at all three sites**

`drizzle/transaction.ts`, inside the `fn({ ... })` bundle (add a module-level sentinel):

```ts
// #877: the tx-bound consent repo only serves reads + createAcceptance, none of
// which call runTransaction; a nested tx here would be a bug, so fail loudly.
const txConsentSentinel: RunTx = () => {
  throw new Error('consentRepo.runTransaction is not available inside a booking tx')
}
```
```ts
        consentRepo: new DrizzleConsentRepository(txDb, txConsentSentinel),
```

`composition/repositories.ts` — in BOTH `buildInMemoryRepos` and `buildOverrideRepos` `runInTransaction` bundles, pass the existing singleton:

```ts
      consentRepo,
```
(`consentRepo` is already in scope in both builders — it's built as `new InMemoryConsentRepository(...)` for the DI bundle.)

- [ ] **Step 4: Run tsc + a booking test — expect GREEN**

Run: `cd packages/api && bunx tsc --noEmit && bun test src/services/booking-creation.test.ts`
Expected: PASS (no behavior change yet — the field is unused).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/types-transactions.ts packages/api/src/repositories/drizzle/transaction.ts packages/api/src/composition/repositories.ts
git commit -m "feat(#877): thread consentRepo into the booking transaction bundle"
```

---

## Task 10: Request fields — `operatorRentalTermsAccepted`, `...Version`, `locale`

**Files:**
- Modify: `packages/shared/src/validators/booking.ts` (`createBookingSchema` base object — Zod strips unknown keys, so the fields MUST be parsed here or the route never sees them)
- Modify: `packages/api/src/services/booking-types.ts:9-34` (service DTO `CreateBookingCommon`)
- Modify: `packages/api/src/routes/bookings.ts` (forward `parsed.data.*` to `service.create`)
- Test: `packages/api/src/routes/bookings.test.ts`

- [ ] **Step 1: RED — the route forwards the three new fields to the service**

Add a route test asserting the parsed body carries the new fields to a spy/fake service (mirror the existing `disclaimerAccepted` forwarding test):

```ts
it('forwards operator-terms acceptance fields to the booking service', async () => {
  const spy = vi.fn().mockResolvedValue({ ok: true, booking: fakeBooking })
  const app = makeBookingApp({ create: spy })
  await app.request('/bookings', postJson({ ...validSpecificBody, operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v3', locale: 'ja' }), renterEnv)
  expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v3', locale: 'ja',
  }), expect.anything(), expect.anything())
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/routes/bookings.test.ts`
Expected: FAIL — fields stripped by the zod schema / not forwarded.

- [ ] **Step 3: GREEN — extend the DTO, schema, and forwarding**

`booking-types.ts` `CreateBookingCommon`, add:

```ts
  // #877 Slice B: renter accepted the operator's published rental terms at
  // checkout, pinning the exact version + displayed locale they rendered. The
  // server requires this only for RENTER self-serve when the operator has a
  // published+effective doc (else 422). locale is the renter's displayed locale.
  operatorRentalTermsAccepted?: boolean
  operatorRentalTermsAcceptedVersion?: string
  locale?: string
```

`packages/shared/src/validators/booking.ts` — add to the base object of `createBookingSchema` (alongside `disclaimerAccepted` at `:44`, BEFORE the `.superRefine`/`.refine` chain, so unknown-key stripping keeps them):

```ts
  operatorRentalTermsAccepted: z.boolean().optional(),
  operatorRentalTermsAcceptedVersion: z.string().optional(),
  locale: z.enum(['en', 'ja', 'zh']).optional(),
```

Then in `routes/bookings.ts`, in the object passed to `service.create(...)`, forward the three (alongside `disclaimerAccepted`):

```ts
    operatorRentalTermsAccepted: parsed.data.operatorRentalTermsAccepted ?? false,
    operatorRentalTermsAcceptedVersion: parsed.data.operatorRentalTermsAcceptedVersion,
    locale: parsed.data.locale,
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/routes/bookings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/booking-types.ts packages/api/src/routes/bookings.ts packages/api/src/routes/bookings.test.ts
git commit -m "feat(#877): accept operator-terms pin fields on booking-create request"
```

---

## Task 11: Resolve + pin + sign (outside tx) and write acceptance (inside tx)

This is the core task. Split into resolver (pure, unit-tested) then the tx wiring (real-pg).

**Files:**
- Create: `packages/api/src/services/operator-terms-acceptance.ts` (pure resolver + guard)
- Modify: `packages/api/src/services/booking-creation.ts` (`BookingService` constructor DI + `create` outside-tx key resolve + `snapshotAndInsert` in-tx resolve/decision/write)
- Modify: `packages/api/src/index.ts` (inject `getSigningKey` + `isOperatorTermsEnabled` thunks; construct `featureFlagsService` before `bookingService`)
- Test: `packages/api/src/services/operator-terms-acceptance.test.ts` + `packages/api/tests/integration/consent-operator-terms-booking.test.ts`

**DI note (P1-1):** `BookingService` today has no consentRepo/signing/flag. It does NOT need a consentRepo — all consent reads/writes go through the tx-bound `repos.consentRepo` added in Task 9. It needs two injected thunks. The signing KEY resolves outside the tx (needs no `operatorId`); the DOC resolves INSIDE `submitInTx` (where `operatorId` is derived from the anchor). Because resolution is now in-tx, C1's residual-race re-read is dropped — the single in-tx resolve is authoritative.

- [ ] **Step 1: RED (unit) — the pure guard decides require/changed/skip**

```ts
import { resolveOperatorTermsDecision } from './operator-terms-acceptance'

const doc = { version: 'v3', locale: 'ja', /* ...full doc */ }

it('skips when caller is not a self-serve renter', () => {
  expect(resolveOperatorTermsDecision({ role: 'OPERATOR_ADMIN', latest: 'v3', doc, accepted: true, pinned: 'v3' }))
    .toEqual({ kind: 'skip' })
})
it('requires acceptance when a doc exists and the flag is false', () => {
  expect(resolveOperatorTermsDecision({ role: 'RENTER', latest: 'v3', doc, accepted: false, pinned: undefined }))
    .toEqual({ kind: 'required' })
})
it('rejects when the pinned version != latest', () => {
  expect(resolveOperatorTermsDecision({ role: 'RENTER', latest: 'v4', doc, accepted: true, pinned: 'v3' }))
    .toEqual({ kind: 'changed' })
})
it('accepts when pinned == latest', () => {
  expect(resolveOperatorTermsDecision({ role: 'RENTER', latest: 'v3', doc, accepted: true, pinned: 'v3' }))
    .toEqual({ kind: 'accept', doc })
})
it('skips when the operator has no published doc', () => {
  expect(resolveOperatorTermsDecision({ role: 'RENTER', latest: undefined, doc: undefined, accepted: false, pinned: undefined }))
    .toEqual({ kind: 'skip' })
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/api && bun test src/services/operator-terms-acceptance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: GREEN — the pure decision function**

```ts
import type { ConsentDocument } from '../stores'

export type OperatorTermsDecision =
  | { kind: 'skip' }
  | { kind: 'required' }
  | { kind: 'changed' }
  | { kind: 'accept'; doc: ConsentDocument }

export function resolveOperatorTermsDecision(p: {
  role: string
  latest: string | undefined
  doc: ConsentDocument | undefined
  accepted: boolean
  pinned: string | undefined
}): OperatorTermsDecision {
  if (p.role !== 'RENTER') return { kind: 'skip' } // §9b delta 1: exclude walk-in/manual/PARTNER
  if (!p.latest || !p.doc) return { kind: 'skip' } // operator has no published+effective terms
  if (!p.accepted) return { kind: 'required' }
  if (p.pinned !== p.latest) return { kind: 'changed' }
  return { kind: 'accept', doc: p.doc }
}
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/api && bun test src/services/operator-terms-acceptance.test.ts`
Expected: PASS.

- [ ] **Step 5: RED (real-pg) — the end-to-end acceptance write + the two 422s**

Create `tests/integration/consent-operator-terms-booking.test.ts` (mirror `consent-records.test.ts` setup — seed an operator with a PUBLISHED `OPERATOR_RENTAL_TERMS` v1 in ja+en, a renter, vehicle/class/location, real db). Drive the real `BookingService.create` with a renter context.

```ts
it('writes a signed operator-terms acceptance row atomically with the booking', async () => {
  const res = await service.create(renterCtx, { ...validSpecific, operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v1', locale: 'ja' })
  expect(res.ok).toBe(true)
  const row = await consentRepo.findBookingAcceptance(res.booking.id, 'OPERATOR_RENTAL_TERMS')
  expect(row).toMatchObject({ bookingId: res.booking.id, operatorId: null, consentType: 'OPERATOR_RENTAL_TERMS', method: 'CLICKWRAP' })
  expect(row?.documentSnapshot).toMatchObject({ version: 'v1', locale: 'ja' })
  expect(row?.recordSignature).toMatch(/^[0-9a-f]{64}$/)
})

it('422 OPERATOR_TERMS_REQUIRED when a published doc exists and the flag is false', async () => {
  const res = await service.create(renterCtx, { ...validSpecific, operatorRentalTermsAccepted: false, locale: 'ja' })
  expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_TERMS_REQUIRED' })
})

it('422 OPERATOR_TERMS_CHANGED when the pinned version is stale', async () => {
  // publish v2 after the renter pinned v1
  const res = await service.create(renterCtx, { ...validSpecific, operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v1', locale: 'ja' })
  expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_TERMS_CHANGED' })
})

it('writes NO acceptance row for an operator with no published terms', async () => {
  const res = await service.create(renterCtx, { ...validSpecificOtherOperator, locale: 'ja' })
  expect(res.ok).toBe(true)
  expect(await consentRepo.findBookingAcceptance(res.booking.id, 'OPERATOR_RENTAL_TERMS')).toBeUndefined()
})

it('does not require terms for an operator-created MANUAL booking of the same operator', async () => {
  const res = await service.create(operatorCtx, { ...validManual, source: 'MANUAL' })
  expect(res.ok).toBe(true) // ctx.role !== 'RENTER' → skip
})
```

- [ ] **Step 6: Run — expect RED**

Run: `cd packages/api && bun test tests/integration/consent-operator-terms-booking.test.ts`
Expected: FAIL — no acceptance row; no 422s.

- [ ] **Step 7a: GREEN — inject the two thunks into `BookingService`**

Add to the `BookingService` constructor (after `verificationGate`), mirroring `ConsentService`/`isSharedCatalogEnabled`:

```ts
    private readonly getSigningKey: () => SigningKey | undefined = resolveSigningKey,
    private readonly isOperatorTermsEnabled: () => Promise<boolean> = async () => false,
```

Import `resolveSigningKey`, `type SigningKey` from `./consent-signing`. In `index.ts`, construct `featureFlagsService` BEFORE `bookingService` (it is currently built after, `:493`), then pass the thunks into `new BookingService(...)` at `:417`: `resolveSigningKey` and `() => featureFlagsService.isEnabled('OPERATOR_TERMS')`. Confirm `OPERATOR_TERMS` exists in the shared flag registry (`@kuruma/shared/feature-flags/registry`) with `serverDefault: false`; add it there if absent (the web already reads the same key).

- [ ] **Step 7b: GREEN — outside the tx: gate + resolve the signing key (fail-fast, no operatorId needed)**

In `create()`, before `runInTransaction`, compute activation and resolve the key (the KEY read needs no `operatorId`, so it belongs here; a missing key throws OUTSIDE the tx = fail-fast, never aborting a booking tx):

```ts
// #877: operator-terms applies only to RENTER self-serve (excludes walk-in/manual/PARTNER)
// and only when the server flag is ON. Resolve the signing key here (outside the tx).
const operatorTermsActive = ctx.role === 'RENTER' && (await this.isOperatorTermsEnabled())
const operatorTermsSigningKey = operatorTermsActive ? this.getSigningKey() : undefined
```

Thread `operatorTermsActive`, `operatorTermsSigningKey`, `input.locale`, `input.operatorRentalTermsAccepted`, `input.operatorRentalTermsAcceptedVersion` into `submitInTx` → `snapshotAndInsert` (they ride on `input` already except the two computed values — add those two to `snapshotAndInsert`'s `args`).

- [ ] **Step 7c: GREEN — inside `snapshotAndInsert`: resolve+decide (pre-insert) then sign+write (post-insert)**

`operatorId` is in `snapshotAndInsert`'s `args`. Resolve the doc + evaluate the decision BEFORE the booking insert (`:741`), so a `required`/`changed` return costs no insert (nothing to roll back):

```ts
    // #877 pre-insert (operatorId known here; consentRepo reads are cheap in-tx).
    let termsDoc: ConsentDocument | undefined
    if (operatorTermsActive) {
      const latest = await repos.consentRepo.findLatestPublishedVersionForOperator(operatorId, 'OPERATOR_RENTAL_TERMS', now)
      const locale = input.locale ?? 'en'
      const doc = latest
        ? (await repos.consentRepo.findPublishedOperatorDocument(operatorId, 'OPERATOR_RENTAL_TERMS', latest, locale))
          ?? (await repos.consentRepo.findPublishedOperatorDocument(operatorId, 'OPERATOR_RENTAL_TERMS', latest, 'en'))
        : undefined
      const decision = resolveOperatorTermsDecision({
        role: ctx.role, latest, doc,
        accepted: input.operatorRentalTermsAccepted ?? false,
        pinned: input.operatorRentalTermsAcceptedVersion,
      })
      if (decision.kind === 'required')
        return { ok: false, status: 422, error: 'Operator rental terms must be accepted', code: 'OPERATOR_TERMS_REQUIRED' }
      if (decision.kind === 'changed')
        return { ok: false, status: 422, error: 'Operator rental terms changed; re-review required', code: 'OPERATOR_TERMS_CHANGED' }
      if (decision.kind === 'accept') termsDoc = decision.doc
    }
```

Then AFTER the booking insert (`const booking = await repos.bookingRepo.create(...)`, so `booking.id` exists), build + sign + write the acceptance row:

```ts
    if (termsDoc) {
      const row = buildAcceptanceRow(
        termsDoc,
        { userId: bookingRenterId, operatorId: null, operatorMembershipId: null, actorRole: ctx.role,
          bookingId: booking.id, method: 'CLICKWRAP', acceptedAt: now, ipAddress: null, userAgent: null },
        operatorTermsSigningKey,
      )
      await repos.consentRepo.createAcceptance(row)
    }
```

Because resolution and the write share the one in-tx snapshot, there is no outside/inside gap and no re-read is needed (this is why §9b delta 8 drops C1's residual-race re-read). `resolveOperatorTermsDecision` is the pure function from Steps 1-3; `ctx` and `now` are already in scope in `snapshotAndInsert`.

- [ ] **Step 8: Run — expect GREEN**

Run: `cd packages/api && bun test tests/integration/consent-operator-terms-booking.test.ts src/services/booking-creation.test.ts`
Expected: PASS — row written + signed; both 422s; no-doc and MANUAL skip.

- [ ] **Step 9: Launder the codes at the route + commit**

Confirm `routes/bookings.ts` maps `CreateBookingResult.code` onto the envelope (`code: createResult.code satisfies ErrorCode` already exists for other codes — the new ones flow through the same narrowing). Add a route test that a `422` create result surfaces `body.code === 'OPERATOR_TERMS_REQUIRED'`.

```bash
git add packages/api/src/services/operator-terms-acceptance.ts packages/api/src/services/operator-terms-acceptance.test.ts packages/api/src/services/booking-creation.ts packages/api/tests/integration/consent-operator-terms-booking.test.ts packages/api/src/routes/bookings.ts packages/api/src/routes/bookings.test.ts
git commit -m "feat(#877): atomic version-pinned operator-terms acceptance in submitInTx"
```

---

## Slice 6 — Web: fetch, modal-on-Reserve, thread operatorId

## Task 12: Send the pin fields from `createBooking`

**Files:**
- Modify: `packages/web/src/vite/bookings/api.ts:103-166`
- Test: `packages/web/src/vite/bookings/api.test.ts`

- [ ] **Step 1: RED — the POST body includes the three fields when set**

```ts
it('sends operator-terms pin fields', async () => {
  const fetchMock = mockFetchOk(fakeBookingDto)
  await createBooking({ ...specificDraft, operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v3', locale: 'ja' }, 'csrf')
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body).toMatchObject({ operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v3', locale: 'ja' })
})
```

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/web && bun test src/vite/bookings/api.test.ts`
Expected: FAIL — fields absent from the body.

- [ ] **Step 3: GREEN — extend `CreateBookingCommon` + the JSON body**

Add to `CreateBookingCommon` (`api.ts:103-117`): `operatorRentalTermsAccepted?: boolean`, `operatorRentalTermsAcceptedVersion?: string`, `locale?: string`. Add to the `JSON.stringify` body (after `disclaimerAccepted`):

```ts
      ...(input.operatorRentalTermsAccepted !== undefined ? { operatorRentalTermsAccepted: input.operatorRentalTermsAccepted } : {}),
      ...(input.operatorRentalTermsAcceptedVersion ? { operatorRentalTermsAcceptedVersion: input.operatorRentalTermsAcceptedVersion } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
```

- [ ] **Step 4: Run — expect GREEN** — `cd packages/web && bun test src/vite/bookings/api.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(#877): web createBooking sends operator-terms pin fields"`

---

## Task 13: Renter published-terms fetch client

**Files:**
- Create: `packages/web/src/vite/operator-terms/publishedApi.ts`
- Test: `packages/web/src/vite/operator-terms/publishedApi.test.ts`

- [ ] **Step 1: RED — fetches + parses the published doc; maps 404 to null**

```ts
it('fetches the published operator terms', async () => {
  mockFetchOk({ version: 'v3', locale: 'ja', title: 'T', body: 'B', acceptanceLabel: 'A', contentHash: 'h' })
  const doc = await fetchPublishedOperatorTerms('op1', 'ja')
  expect(doc).toMatchObject({ version: 'v3', locale: 'ja', body: 'B' })
})
it('returns null when none published (404)', async () => {
  mockFetch404()
  expect(await fetchPublishedOperatorTerms('op1', 'ja')).toBeNull()
})
```

- [ ] **Step 2: Run — expect RED** — module not found.
- [ ] **Step 3: GREEN — implement + zod schema + query options**

```ts
import { z } from 'zod'
import { getApiBaseUrl } from '@/vite/api-base' // P2-5: Vite clients use @/vite/api-base, not @/lib
import { unwrap } from '@/lib/api-error'

export const publishedOperatorTermsSchema = z.object({
  version: z.string(), locale: z.string(), title: z.string(), body: z.string(),
  acceptanceLabel: z.string(), contentHash: z.string(),
})
export type PublishedOperatorTerms = z.infer<typeof publishedOperatorTermsSchema>

export async function fetchPublishedOperatorTerms(operatorId: string, locale: string): Promise<PublishedOperatorTerms | null> {
  const res = await fetch(`${getApiBaseUrl()}/operator-terms/published?operatorId=${encodeURIComponent(operatorId)}&locale=${locale}`, { credentials: 'include' })
  if (res.status === 404) return null
  return unwrap(res, publishedOperatorTermsSchema)
}

export const publishedOperatorTermsQuery = (operatorId: string, locale: string) => ({
  queryKey: ['operator-terms', 'published', operatorId, locale] as const,
  queryFn: () => fetchPublishedOperatorTerms(operatorId, locale),
})
```

- [ ] **Step 4: Run — expect GREEN** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(#877): web renter published-terms fetch client"`

---

## Task 14: Thread `operatorId` loader → wizard → PaymentStep

**Files:**
- Modify: `packages/web/src/routes/$locale/_renter/bookings/new.tsx` (loader already has `detail.storefront.operatorId`)
- Modify: `packages/web/src/vite/reservation/ReservationWizard.tsx`
- Modify: `packages/web/src/vite/reservation/PaymentStep.tsx`

- [ ] **Step 1: RED — PaymentStep renders the terms gate only when operatorId + flag present**

Add a component test (React Testing Library, existing web harness) asserting: with `operatorId` and `OPERATOR_TERMS` flag on and a published doc, the Reserve click opens the modal instead of submitting.

```ts
it('opens the terms modal on Reserve when operator terms are published', async () => {
  renderPaymentStep({ operatorId: 'op1', flag: true, published: fakeTerms })
  await userEvent.click(screen.getByText('Reserve'))
  expect(await screen.findByRole('dialog')).toHaveTextContent(fakeTerms.title)
  expect(createBookingSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run — expect RED** — PaymentStep has no `operatorId` prop / no modal.
- [ ] **Step 3: GREEN — thread the prop**

`new.tsx`: pass `operatorId={detail.storefront.operatorId}` into `<ReservationWizard ... />`.
`ReservationWizard.tsx`: add `readonly operatorId: string` to props (`:22-38`); pass `operatorId={operatorId}` into `<PaymentStep ... />` (`:194-196`).
`PaymentStep.tsx`: add `readonly operatorId: string` to `PaymentStepProps` (`:10-17`).

- [ ] **Step 4: Run — expect GREEN (after Task 15 supplies the modal)** — defer the assertion to Task 15; here just confirm tsc passes with the new prop threaded.

Run: `cd packages/web && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(#877): thread storefront operatorId into PaymentStep"`

---

## Task 15: Modal-on-Reserve + 422 handling

**Files:**
- Create: `packages/web/src/vite/reservation/OperatorTermsModal.tsx`
- Modify: `packages/web/src/vite/reservation/PaymentStep.tsx`
- Test: `packages/web/src/vite/reservation/PaymentStep.test.tsx`

- [ ] **Step 1: RED — full flow: modal → agree → submit with pin; 422 CHANGED re-opens**

```ts
it('submits with the pinned version after the renter agrees', async () => {
  renderPaymentStep({ operatorId: 'op1', flag: true, published: { version: 'v3', /* ... */ } })
  await userEvent.click(screen.getByText('Reserve'))
  await userEvent.click(screen.getByRole('button', { name: /agree/i }))
  expect(createBookingSpy).toHaveBeenCalledWith(
    expect.objectContaining({ operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: 'v3', locale: 'ja' }),
    expect.any(String),
  )
})
it('re-opens the modal with fresh terms on 422 OPERATOR_TERMS_CHANGED', async () => {
  createBookingSpy.mockRejectedValueOnce(new ApiError('changed', 422, 'OPERATOR_TERMS_CHANGED'))
  // ... agree, expect refetch + modal shown again with the new version
})
```

- [ ] **Step 2: Run — expect RED** — no modal component.
- [ ] **Step 3: GREEN — build `OperatorTermsModal` and wire PaymentStep**

`OperatorTermsModal.tsx` — uses `@/components/ui/dialog` (90dvh scroll region), renders `title` + scrollable `body`, a `DialogFooter` with an Agree button labeled from `acceptanceLabel`:

```tsx
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { PublishedOperatorTerms } from '@/vite/operator-terms/publishedApi'

export function OperatorTermsModal(props: {
  terms: PublishedOperatorTerms; open: boolean; onOpenChange: (o: boolean) => void; onAgree: () => void; pending: boolean
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{props.terms.title}</DialogTitle></DialogHeader>
        <div className="whitespace-pre-wrap text-sm text-foreground">{props.terms.body}</div>
        <DialogFooter>
          <Button type="button" onClick={props.onAgree} disabled={props.pending}>{props.terms.acceptanceLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

In `PaymentStep.tsx`:
- `const operatorTermsEnabled = useFeatureFlag('OPERATOR_TERMS')`.
- `const { data: terms } = useQuery({ ...publishedOperatorTermsQuery(operatorId, locale), enabled: operatorTermsEnabled })`.
- `const [termsOpen, setTermsOpen] = useState(false)`.
- Change the Reserve `onClick`: if `operatorTermsEnabled && terms && !termsAccepted` → `setTermsOpen(true)` (open modal) instead of `mutation.mutate()`.
- The modal's `onAgree` sets an internal `acceptedVersion` and calls `mutation.mutate()`.
- `mutationFn` sends `operatorRentalTermsAccepted: true, operatorRentalTermsAcceptedVersion: terms.version, locale` when terms exist.
- Extend the `message`/`onError` mapping (`:56-74`): on `error.code === 'OPERATOR_TERMS_CHANGED'` → `queryClient.invalidateQueries(publishedOperatorTermsQuery(...))` then re-open the modal; on `error.code === 'OPERATOR_TERMS_REQUIRED'` → open the modal. Add sibling `if (error.code === 'OPERATOR_TERMS_CHANGED') return t('payment.termsChanged')` branches.

The existing inline liability disclaimer block stays UNCHANGED (it's a separate consent).

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/web && bun test src/vite/reservation/PaymentStep.test.tsx`
Expected: PASS — agree submits the pin; 422 CHANGED refetches + re-opens.

- [ ] **Step 5: Add i18n keys + commit**

Add `payment.termsChanged` / any modal strings to the `reservation` namespace (en/ja/zh). Then:

```bash
git add packages/web/src/vite/reservation/OperatorTermsModal.tsx packages/web/src/vite/reservation/PaymentStep.tsx packages/web/src/vite/reservation/PaymentStep.test.tsx packages/web/src/**/i18n/**
git commit -m "feat(#877): operator-terms modal-on-Reserve with version-pin + 422 handling"
```

---

## Slice 7 — Deploy / observability

## Task 16: `CONSENT_SIGNING_KEY` deploy presence check + signing observability

**Files:**
- Modify: the deploy presence check (search `deploy.yml` / the env-presence guard that already lists Phase-2 ToS secrets)
- Modify: `packages/api/src/services/booking-creation.ts` (log on sign/resolve failure)

- [ ] **Step 1: Confirm current state**

Run: `cd ../kuruma-consent-sliceb && rg -n "CONSENT_SIGNING_KEY" .github/ deploy* packages/api/src | cat`
Expected: it already exists for the Phase-2 ToS accept path; confirm the booking deploy path asserts it too (add it to the presence list if the booking service is a separate deploy gate).

- [ ] **Step 2: Add presence assertion (if missing) + a resolve-failure log**

Ensure a missing `CONSENT_SIGNING_KEY` fails the deploy check, not each booking. In `booking-creation.ts`, wrap the outside-tx `this.getSigningKey()` so a thrown/undefined key in production is logged with `operatorId` + `bookingCode` context before it bubbles (mirror the Stripe sentinel pattern referenced in `consent-signing.ts`).

- [ ] **Step 3: Run the full api suite + commit**

Run: `cd packages/api && bun test`
Expected: PASS.

```bash
git commit -am "chore(#877): CONSENT_SIGNING_KEY deploy presence + signing observability"
```

---

## Slice 8 — Scope guard + full verification

## Task 17: Confirm both flags OFF + end-to-end gates green

**Files:** none (verification).

- [ ] **Step 1: Verify both dark paths (the flag is already wired in Tasks 8 + 11)**

The server flag `OPERATOR_TERMS` (`serverDefault: false`) gates the endpoint (Task 8 → 404) and the booking require-branch (Task 11 Step 7b → `operatorTermsActive` false). `VITE_FEATURE_OPERATOR_TERMS` gates the web (Task 15). Confirm the registry default is `false` and that with the flag OFF the create path skips entirely even when a published doc exists (this test belongs in the Task 11 integration file; add it there if not already present):

```ts
it('flag OFF: no require, no 422, no row even with a published doc', async () => {
  const res = await serviceFlagOff.create(renterCtx, { ...validSpecific, operatorRentalTermsAccepted: false, locale: 'ja' })
  expect(res.ok).toBe(true) // operatorTermsActive === false → branch skipped
  expect(await consentRepo.findBookingAcceptance(res.booking.id, 'OPERATOR_RENTAL_TERMS')).toBeUndefined()
})
```

(`serviceFlagOff` = a `BookingService` built with `isOperatorTermsEnabled: async () => false`; the flag-ON service is used by the Task 11 acceptance tests.)

- [ ] **Step 2: Full gates**

Run: `cd ../kuruma-consent-sliceb && bunx biome check . && cd packages/api && bunx tsc --noEmit && bun test && cd ../web && bunx tsc --noEmit && bun test`
Expected: PASS everywhere.

- [ ] **Step 3: Commit**

```bash
git commit -am "test(#877): operator-terms stays dark under both flags OFF"
```

---

## Self-Review (run before opening the PR)

- **Spec coverage:** addendum §4 Slices 1–8 → Tasks: Slice1→T1, Slice2(migration)→T2/T3/T4, Slice3(repo/service)→T4/T5/T6, Slice4(read)→T7/T8, Slice5(tx+accept)→T9/T10/T11, Slice6(web)→T12–T15, Slice7(deploy)→T16, Slice8(scope)→T17. §9b deltas 1–8 → T11(role gate), T10(locale, shared validator), T9(consentRepo Pick), T5/T11(field names+helper), T6(shape/reject), T14(operatorId thread), T2/T3(rename lockstep), T11 Steps 7a-7c(delta 8: DI thunks + in-tx resolve, no re-read). Server `OPERATOR_TERMS` flag → endpoint T8 (404 when off) + create-path T11/T17.
- **Placeholder scan:** every code-changing step carries real code; commands have expected output. The only research step is T16-S1 (locating the existing presence check) — it is a `rg` with a concrete pattern, not a TODO.
- **Type consistency:** `findBookingAcceptance(bookingId, consentType)`, `buildAcceptanceRow(doc, subject, signingKey)`, `resolveOperatorTermsDecision({...})`, `getPublished(operatorId, locale, now)`, seal names `consent_unique_booking_type` / `consent_booking_type_chk`, codes `OPERATOR_TERMS_REQUIRED` / `OPERATOR_TERMS_CHANGED` — used identically across tasks.

## Execution Handoff

Implement with **superpowers:subagent-driven-development** (recommended) — one fresh subagent per task, two-stage review between tasks — or **superpowers:executing-plans** for batched inline execution. Tasks 1–8 are largely independent given Task 1 lands first; Tasks 9–11 are the critical path and should be reviewed most carefully; Tasks 12–15 (web) depend on Task 1 (codes) + Task 8 (endpoint) + Task 11 (server behavior) being green.
