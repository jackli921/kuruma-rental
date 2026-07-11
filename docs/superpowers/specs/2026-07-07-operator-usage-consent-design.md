# Operator usage-consent (rental terms) — design spec

Status: APPROVED (v1.1, owner-locked 2026-07-07). Tracking: extends issue #877 (consent ledger).

v1.1 addendum (2026-07-07, session 2 — locked after ground-truth re-verification against live schema):
- **Release:** gate the whole feature behind `VITE_FEATURE_OPERATOR_TERMS`. Slice A ships dark behind the
  flag; flip on only once Slice B (renter acceptance) lands (§9).
- **Immutability:** DB trigger + service guard, both — not service-only (§5.1).
- **Type name:** locked to `OPERATOR_RENTAL_TERMS` (§13).
Date: 2026-07-07
Relationship to #877: this is a NEW capability beyond the approved consent-ledger spec
(`docs/superpowers/specs/2026-06-15-consent-ledger-design.md`). It reuses that ledger's tables,
service, signing, and evidence. It is NOT one of #877's four seeded platform consent types.

## 1. Problem / intent

Operators must be able to author and publish their **own** rental-terms / usage-consent document
that a **renter agrees to when booking that operator's car**. Today `consent_documents` holds only
platform-global, seeded text (ToS, privacy, liability, operator-agreement); there is no path for an
operator to author content, and no per-operator scoping. This spec adds that, as a thin extension of
the existing ledger.

## 2. Product decisions (owner-locked)

1. **Type it in (structured text), not file upload.** Operators author `title`/`body`/`acceptanceLabel`
   with `en` required and `ja`/`zh` optional (fall back to `en`). Chosen for translatability to
   international-tourist renters, reuse of the ledger's versioning/hashing/signing/evidence, and future
   flexibility (text-first can later grow an optional file attachment; file-first cannot grow into
   translatable structured text). PDF upload is explicitly out of scope (§12).
2. **Every booking (per-rental).** The renter agrees on each booking, matching the industry standard for
   rental agreements (Hertz/Enterprise per pickup; Turo/Getaround/Airbnb house-rules per trip). Behaves
   as a per-booking (`PER_EVENT`) consent, exactly like the liability disclaimer, distinguished by
   `consentType`.
3. **Optional per operator; platform terms are the fallback.** An operator is never forced to author
   terms to list cars. The existing platform ToS/liability already covers every booking, so "no operator
   terms" simply means no extra renter step — no separate "default operator terms" document is built.

## 3. Design principle — thin extension, minimal blast radius

Additive, not a rewrite. The single most important structural decision (from architect review, 2026-07-07):

> **`operatorId` lives ONLY on `consent_documents` (the author). The acceptance row's `operatorId`
> stays NULL for operator-terms; the operator is recovered by joining the acceptance's `documentId`
> back to `consent_documents.operatorId`.**

This dodges two CRITICAL DB-constraint collisions (§4.4, §4.5) and leaves the entire `OPERATOR_AGREEMENT`
half of the schema untouched. Operator-terms is then structurally identical to the (not-yet-merged)
per-booking liability consent: `userId + bookingId + documentId`, `operatorId NULL`, signed + snapshotted.

**Ground truth that shapes scope** (verified on disk, do not assume otherwise):
- Liability is NOT in the ledger yet (Phase 4 of #877 unmerged): the disclaimer is still inline booking
  columns (`booking-creation.ts` ~`disclaimerAcknowledgedAt`/`disclaimerTermsVersion`). So an
  operator-terms row would be the **first per-booking consent row in prod**.
- `booking-creation.ts` injects **no consent repo**; `TransactionRepos` carries none. Writing the
  acceptance atomically at booking-create is real wiring, not free reuse (§6).

## 4. Data model changes (all additive)

### 4.1 New consent type
Add `OPERATOR_RENTAL_TERMS` to `CONSENT_TYPES` (`packages/shared/src/enums.ts`). Add its
`CONSENT_CARDINALITY` entry = `PER_EVENT` (the `Record<ConsentType,...>` forces this to compile).

### 4.2 `consent_documents` gains a nullable `operatorId`
- `operatorId text` nullable, FK → `operators.id` (`onDelete: 'restrict'`). Platform docs stay NULL;
  operator-authored docs set it.
- FK-covering index on `operatorId` (lint:fk-indexes).

### 4.3 Document uniqueness — two partial uniques (NOT one nullable-column unique)
Replacing the current `unique(type, version, locale)` with `unique(operatorId, type, version, locale)`
would let two platform `RENTER_TOS v1 en` rows both insert (Postgres treats NULLs as distinct),
destroying platform-doc dedup. Instead keep BOTH:
- `UNIQUE(type, version, locale) WHERE operatorId IS NULL` — preserves the platform invariant.
- `UNIQUE(operatorId, type, version, locale) WHERE operatorId IS NOT NULL` — scopes operator docs.
Keep the existing `unique(id, type)` composite-FK target as-is.

### 4.4 Liability CHECK — widen to include the new type
`consent_liability_booking_chk` today: `(consentType = 'RENTER_LIABILITY') = (bookingId IS NOT NULL)`.
A per-booking operator-terms row sets `bookingId` and would be rejected (`false = true`). Widen to:
`(consentType IN ('RENTER_LIABILITY','OPERATOR_RENTAL_TERMS')) = (bookingId IS NOT NULL)`.
Migration-safe: no operator-terms rows exist; every current row still satisfies it.

### 4.5 Operator-agreement CHECK and operator-document seal — UNTOUCHED
Because the acceptance keeps `operatorId NULL` (§3):
- `consent_operator_agreement_chk` `(consentType='OPERATOR_AGREEMENT') = (operatorId IS NOT NULL)`
  passes for operator-terms rows (`false = false`). No change.
- `consent_unique_operator_document` on `(operatorId, documentId) WHERE operatorId IS NOT NULL` never
  applies to operator-terms rows (their `operatorId` is NULL). No 2nd-renter collision. No change.

### 4.6 Per-booking idempotency seal — generalize to `(bookingId, consentType)`
`consent_unique_booking_liability` today: `unique(bookingId) WHERE bookingId IS NOT NULL` — admits only
ONE consent row per booking. With liability AND operator-terms both per-booking they'd collide. Generalize
to `unique(bookingId, consentType) WHERE bookingId IS NOT NULL` (DROP INDEX + CREATE UNIQUE INDEX). Safe:
zero prod rows under this predicate today; preserves "one liability per booking" as "one row per
(booking, type)".

## 5. Document authoring (operator side)

### 5.1 State machine (first runtime writer of `consent_documents`)
`DRAFT` (editable) → `PUBLISHED` (immutable; new wording = a new version row) → `ARCHIVED`.
- Enforce immutability of PUBLISHED rows in the service AND with a DB guard (trigger/rule blocking UPDATE
  of a PUBLISHED row's content) — **owner-locked v1.1: both, not service-only.** Consistent with the repo's
  "DB-enforced, not service-promised" culture and existing triggers (`0015`/`0037`/`0069`). #877 §9.3 locked
  "authoring = seed/migration, no admin UI" — this feature is the first runtime authoring path, so the guard
  does not exist yet and must be added.
- `contentHash` recomputed on publish over `(title, body, acceptanceLabel)` (reuse existing canonical form).

### 5.2 Authz — mirror add-on/insurance operator-authoring
- Routes use `resolveOperatorIdForWrite` + `assertFleetWriteWithinOperator` + `fleetWriteDenialResult`
  (`packages/api/src/tenancy.ts`); fleet-write roles only.
- Operator-scoped list/read (an operator sees only its own drafts/published terms).
- Platform-admin cross-operator parity via the `?operatorId=` picker, same as add-ons (#1442/#1456).

### 5.3 Operator-scoped resolution repo methods (net-new)
The global `findLatestPublishedVersion(type, now)` / `findPublishedDocument(...)` are operator-blind and
meaningless for operator-terms once >1 operator publishes. Add:
- `findLatestPublishedVersionForOperator(operatorId, type, now)`
- `findPublishedOperatorDocument(operatorId, type, version, locale)`
across `types-consent.ts` + drizzle + in-memory impls.

### 5.4 i18n
`en` required; `ja`/`zh` optional with fallback to `en` (reuse `FALLBACK_LOCALE` /
`presentationLocaleSchema`). Unlike seeded platform docs, operator text has no ja/zh guarantee, so the
fallback is exercised constantly — pin it with a test (architect L2).

## 6. Renter acceptance (at booking-create, atomic)

- On booking creation, resolve the booked operator's **PUBLISHED + effective** operator-terms doc
  (§5.3), in the renter's locale (fallback en). If none, no acceptance (Decision 3).
- Snapshot the resolved document + sign the acceptance (Tier-1) and insert it **inside the booking
  transaction** (`submitInTx`), so a booking never persists without its consent row.
  - Add a consent repo to `TransactionRepos` and rebind it in the tx factory
    (`repositories/drizzle/*-transaction.ts` — the sanctioned `new Concrete` carve-out per AGENTS.md).
- **Service dispatch fix (architect H3):** `findBookingAcceptance` must take `consentType`
  (`findBookingAcceptance(bookingId, consentType)`) across `types-consent.ts` + both impls, and the
  shape/idempotency pre-check in `services/consent.ts` must learn `OPERATOR_RENTAL_TERMS`. The in-memory
  `assertUnique` disjointness must mirror `(bookingId, consentType)` or in-memory and Drizzle tests diverge.
- **Accept-endpoint hardening (architect M2):** `POST /consent/accept` must explicitly reject
  `OPERATOR_RENTAL_TERMS`. Operator-terms is written only on the booking path, never via the generic
  accept endpoint (which is unbound to a booking the renter owns).
- Bind acceptance to booking **CREATE**, not the Stripe checkout redirect. Atomic creation dissolves the
  publish-mid-flow / version-change-mid-flow races: whatever is published+effective at the instant
  `submitInTx` runs is snapshotted; a later publish governs the next booking.

## 7. Signing, evidence, governance

- **`CONSENT_SIGNING_KEY` blast radius (architect M1):** `resolveSigningKey()` throws in prod when unset.
  Today no booking signs anything; routing operator-terms signing through `submitInTx` makes a
  missing/misrotated key **500 every booking** for operators with published terms. Add `CONSENT_SIGNING_KEY`
  to the deploy presence check before this ships (it is already required for the merged Phase-2 ToS gate,
  so it should already be set — the presence check is defense-in-depth for the booking path).
- **Governance/evidence operator resolution (architect L1):** operator-terms acceptances have
  `operatorId NULL`; the governance/evidence surfaces resolve the operator via
  `documentId → consent_documents.operatorId` join. Decide and document the display.

## 8. Migrations (ordered — split, never combined)

Postgres forbids using a freshly added enum value in the same transaction it was added (the #27 incident
class). Therefore, in order, `db:generate → db:migrate → db:verify` between each:
1. `ALTER TYPE consent_type ADD VALUE 'OPERATOR_RENTAL_TERMS'` — standalone file, nothing else.
2. `consent_documents`: add nullable `operatorId` + FK + fk-cover index; swap the doc uniqueness to the
   two partial uniques (§4.3).
3. Widen the liability CHECK (§4.4); generalize the booking seal to `(bookingId, consentType)` (§4.6);
   add the PUBLISHED-row immutability guard (§5.1).

(Steps 2 and 3 may be combined if generation ordering allows, but the enum ADD VALUE is always its own
migration ahead of any statement referencing the literal.)

## 9. Phasing (vertical, each a shippable TDD slice)

**All slices land behind `VITE_FEATURE_OPERATOR_TERMS` (v1.1).** Slice A's operator authoring surface ships
dark behind the flag; the flag is flipped on only once Slice B (renter acceptance) is merged, so operators
never author into a void that renters can't yet see.

- **Slice A — schema + enum + resolution + authoring API + operator web form.**
  Migrations §8(1)+(2)+the immutability guard; enum + cardinality; the two operator-scoped repo methods;
  authoring service (DRAFT/PUBLISH/ARCHIVE + authz mirror); operator routes; operator web surface
  (mirror add-ons/insurance forms, 3-locale text + nudge). No renter effect yet.
- **Slice B — renter acceptance at booking-create.**
  Booking seal generalization + liability CHECK widen (§8-3); consent repo into `TransactionRepos` + tx
  factory; resolve+snapshot+sign in `submitInTx`; `findBookingAcceptance(bookingId, consentType)` +
  shape-check + in-memory double; accept-endpoint hardening; renter checkout UI shows the operator's terms
  + agree control; `CONSENT_SIGNING_KEY` presence check.
- **Slice C (optional) — governance/evidence visibility** for operator-terms rows (operator resolved by
  join); admin/governance surfacing.

## 10. Testing strategy

- **Real-pg integration tests** for every constraint change (two partial uniques, widened liability CHECK,
  generalized `(bookingId, consentType)` seal, PUBLISHED-immutability guard) — in-memory cannot catch
  `23505`/`23514`/trigger behavior. Follow the existing `consent`-suite real-pg pattern.
- **Mutation-resistant assertions** (specific status/shape, not truthiness) per the repo's testing rules.
- **i18n fallback** test (ja/zh missing → en) (§5.4).
- **Idempotency**: two per-booking types on one booking both persist; re-accept is a no-op returning the
  matching-type row (guards against H3 returning the wrong row).
- **Authz**: operator cannot author/read another operator's terms; renter cannot mint an operator-terms
  acceptance via `/consent/accept`.
- Unit tests for the pure resolver (operator-scoped latest published), service state machine, and the
  booking-create snapshot/sign path.

## 11. Blast radius (files, indicative)

- `packages/shared/src/enums.ts` (type + cardinality), `packages/shared/src/db/consent.ts` (column,
  uniques, CHECK, seal, guard), `drizzle/` (3 ordered migrations).
- `packages/api/src/repositories/types-consent.ts` + `drizzle/consent.ts` + `in-memory/consent.ts`
  (operator-scoped resolution, `findBookingAcceptance` signature, `assertUnique`).
- `packages/api/src/services/consent.ts` (shape check, dispatch), authoring service (new),
  `services/consent-signing.ts` (unchanged, but now on the booking path), `services/booking-creation.ts`
  + `repositories/drizzle/*-transaction.ts` (tx wiring).
- `packages/api/src/routes/` (new operator authoring router; `consent.ts` accept hardening).
- `packages/web/src/vite/` (operator terms authoring surface mirroring add-ons/insurance; renter
  checkout terms step in the reservation flow).
- Deploy: `CONSENT_SIGNING_KEY` presence check.

## 12. Out of scope / non-goals

- PDF / file upload (structured text chosen; a future optional attachment can be added on top).
- Tier-2 e-sign (`method=ESIGN`/`signatureRef`) — the ledger's seam stays unused here.
- Auto-translation / MT.
- Migrating the platform liability disclaimer into the ledger (#877 Phase 4) — independent; this feature
  does not depend on it and must not block on it.
- A separate "default operator terms" document — the existing platform terms are the fallback.

## 13. Minor / open

- Type name **locked to `OPERATOR_RENTAL_TERMS`** (v1.1). Alternatives considered and rejected:
  `OPERATOR_TERMS` (ambiguous vs the existing `OPERATOR_AGREEMENT` type), `OPERATOR_USAGE_CONSENT`
  (wordier enum literal).
