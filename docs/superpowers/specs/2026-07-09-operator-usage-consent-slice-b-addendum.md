# Operator Usage Consent — Slice B Design Addendum

> Status: **DRAFT for owner review** (2026-07-09).
> Addendum to `docs/superpowers/specs/2026-07-07-operator-usage-consent-design.md` (the "baseline spec", §4–§12 architect-reviewed).
> Scope: the **renter** accepts an operator's `OPERATOR_RENTAL_TERMS` consent doc atomically at booking-create.
> Slice A (operator authoring) already SHIPPED (PR #1501), flag-gated DARK behind `VITE_FEATURE_OPERATOR_TERMS`.
> This slice stays **DARK** too. No GA flip here (that is Path-to-GA #1476).

This document supersedes the "Design to PRESENT" bullets that lived only in STATE.md.
It folds in (a) the 3 owner decisions locked 2026-07-09 and (b) the architect review's must-fix changes (C1/H1/H2/H3 + M/L).
Once approved, it becomes the input to `superpowers:writing-plans`.
No implementation code exists yet.

---

## 1. What changed since the 2026-07-07 baseline

- **Slice A shipped** (authoring: enum, `operatorId` column, immutability guard, publish flow).
- **#1498 + #1499 merged as PR #1511** (develop tip `a02e9cdb`): the Slice B tx precursor.
  - `DrizzleConsentRepository` constructor is now `(db, runTx)` — the composition root already passes both.
  - Added atomic `replaceOperatorDraftRows` (drizzle `runTx` delete+insert; in-memory twin).
  - `findBookingAcceptance` is still **bookingId-only** (Slice B must add a `consentType` arg).
  - `TransactionRepos` still carries **no** consent repo — that is net-new here (Task 3).
- **#1513 OPEN** (`fix/1498-inmemory-atomicity-parity`): in-memory `replaceOperatorDraftRows` rollback-parity fix + witness test. Independent of this slice's design; should land before/with promotion.
- **Architect review of the original Slice B design: not plan-ready as-is.** Four must-fix design changes, resolved below.
- **Review round 1 (2026-07-09), verified against `origin/develop`, five findings applied:** P1a — the signature binds `bookingId`, which only exists after the booking insert, so SIGN moves INSIDE the tx (H3 corrected). P1b — operator terms `version` is a `v1`-style **string**, not a number (exact-string pin). P1c — no renter-readable published-terms endpoint exists; every `/operator-terms` route is fleet-write-only → **new Slice 4**. P2a — `OPERATOR_TERMS_*` must be real `ErrorCode` entries (SCREAMING_SNAKE, expand-only union). P2b — H1 narrowed to gate the **require branch only**, not publish.

---

## 2. Owner decisions (locked 2026-07-09, with the C1 reversal)

1. **Consent capture = EXPLICIT flag, VERSION-PINNED** (revised — see C1).
   The client sends `operatorRentalTermsAccepted: true` **plus the pinned `operatorRentalTermsAcceptedVersion` and displayed `locale`** it rendered.
   The server requires the flag when the operator has a published+effective doc, and **only ever seals/signs the exact pinned (version, locale)**.
   If `pinned !== latest` at `submitInTx`, the server rejects **422 `OPERATOR_TERMS_CHANGED`** rather than signing text the renter never saw.
   *(This reverses the original "snapshot-current, NO version-pin" wording — the architect flagged snapshot-current as a consent TOCTOU that cryptographically signs unseen content.)*
2. **Checkout UX = MODAL on Reserve.**
   Renter clicks Reserve; if the operator has published terms that are unaccepted, a modal shows the terms (title + body, scrollable) with an agree control; agree → submit with the flag + pinned version.
   No terms → Reserve submits directly.
3. **Scope = STAY DARK.**
   Build and test the renter path but leave `VITE_FEATURE_OPERATOR_TERMS` OFF and the server flag OFF.
   Flipping on (GA) is a separate follow-up under Path-to-GA #1476.

---

## 3. Must-fix resolutions (architect review → design)

| # | Sev | Problem | Resolution folded into this design |
|---|-----|---------|-------------------------------------|
| **C1** | CRITICAL | Boolean-only accept is a consent TOCTOU: server resolves "latest" at submit, so an operator republish mid-checkout seals+signs text the renter never saw. | **Version-pin.** Client pins `(version, locale)`; server 422 `OPERATOR_TERMS_CHANGED` when `pinned !== latest`; seal/sign the **exact** pinned version only. Belt-and-suspenders: one cheap in-tx re-read (see H3) closes the residual race between resolve and insert. |
| **H1** | HIGH | `VITE_` flag is web-only. `submitInTx` would require terms for ANY operator with a PUBLISHED row regardless of flag → a fleet-write operator publishing via the authoring API would 422 their own renters even while the feature is "off". | **Server-side feature flag** gates the **require-acceptance branch only** (P2b — narrowed). Publish stays as Slice A shipped it: gating publish would retro-change a shipped route and would block operators pre-authoring before GA. Inject as an `isOperatorTermsEnabled` thunk (not a `VITE_` read). When off: no require, no 422, no row — so a doc published via the authoring API never 422s a renter. |
| **H2** | HIGH | MANUAL / walk-in bookings share `submitInTx` → would 422 on the operator's OWN terms. | Mirror the existing `disclaimerAccepted` rule: **only renter self-serve (DIRECT, non-walk-in)** resolves + requires terms. Operator-created bookings skip the branch entirely. |
| **H3** | HIGH | `resolveSigningKey()` throwing INSIDE the tx couples booking availability to the consent secret and aborts a full booking tx. | **FC/IS, corrected for P1a:** the signature binds `bookingId`, which only exists after the booking insert — so *resolve+validate the key* and *resolve the doc + build the content snapshot* OUTSIDE the tx (fail-fast, no availability coupling), then run the pure **HMAC sign INSIDE the tx after the booking insert** yields the id, using the pre-resolved in-memory key. In-tx order: re-read latest `(version, locale)` → insert booking → sign → insert acceptance. (Rejected the preallocate-id alternative — it retrofits app-side id generation into the booking insert, touching Slice-A-adjacent code.) Land `CONSENT_SIGNING_KEY` in `deploy.yml` presence check + observability. |
| M1 | MED | Locale must reach `submitInTx`. | Thread the renter's resolved locale as an explicit input to `submitInTx` (do not re-derive inside). |
| M2 | MED | Signer duplicated across paths. | DRY via one `buildRow(snapshot, signature)` helper reused by unit + real path. |
| M3 | MED | Subject-shape check could be partial. | Make the `OPERATOR_RENTAL_TERMS` shape-check a TOTAL function (fail-closed on unknown shape). |
| M4 | MED | Throwing-sentinel `runTx` in the tx factory. | Prefer `Pick<>` type-narrowing over a throwing sentinel when rebinding repos into the tx. |
| L1 | LOW | Seal name. | Rename booking seal `consent_unique_booking_liability` → `consent_unique_booking_type`. |
| L2 | LOW | Stale comment. | Fix the in-memory `assertUnique` comment. |
| L3 | LOW | Over-building. | Do NOT add an in-tx idempotency pre-check; the unique seal + `findBookingAcceptance` replay is enough. |

---

## 4. Design — vertical TDD slices

Each slice is a shippable RED→GREEN increment. Line numbers below are **reference-level** (from the develop `81c65107` code map); the writing-plans / TDD step re-confirms exact positions against the live tree, which moved with #1511.

### Slice 1 — Migration (one ordered file)
- Generalize the booking seal: `consent_unique_booking_liability` → `unique(bookingId, consentType) WHERE bookingId IS NOT NULL` (DROP + CREATE; 0 prod rows under the predicate, safe). Name it `consent_unique_booking_type` (L1).
- Widen the CHECK `consent_liability_booking_chk` → `(consentType IN ('RENTER_LIABILITY','OPERATOR_RENTAL_TERMS')) = (bookingId IS NOT NULL)` so `OPERATOR_RENTAL_TERMS` may carry `bookingId` while `operatorId` stays NULL.
- (enum + `operatorId` column + immutability guard already landed in Slice A.)
- Tests: real-pg 23505 (unique) and 23514 (CHECK).

### Slice 2 — Consent repo/service contract
- `findBookingAcceptance(bookingId, consentType)` across `types-consent` + drizzle + in-memory (add the `consentType` arg; today it is bookingId-only).
- `services/consent.ts` shape-check learns `OPERATOR_RENTAL_TERMS` (`bookingId` NOT NULL, `operatorId` NULL) as a **total** function (M3).
- in-memory `assertUnique` mirrors `(bookingId, consentType)`; fix its comment (L2).
- `POST /consent/accept` **rejects** `OPERATOR_RENTAL_TERMS` (booking-path only; no self-mint).

### Slice 3 — Tx wiring
- Add `consentRepo` to `TransactionRepos` (`repositories/types-transactions.ts`).
- Rebind the drizzle consent repo inside the tx factory (`repositories/drizzle/transaction.ts`) — note the **#1511 ctor change**: `new DrizzleConsentRepository(txDb, runTx?)`, sanctioned `new Concrete` carve-out. Prefer `Pick<>` narrowing over a throwing-sentinel `runTx` (M4).
- Wire the in-memory tx composition to match.

### Slice 4 — Renter-safe published-terms read (P1c, net-new)
The modal needs the published doc, but every `/operator-terms` route is `requireFleetWriteRole` (authoring-only) — no renter-readable endpoint exists.
- Add `GET /operator-terms/published?operatorId=&locale=` (or a nested read), auth = `requireAuth()` only (any authenticated renter), NO fleet-write gate.
- Returns ONLY the published+effective localized doc — `{ version, locale, title, body, acceptanceLabel, contentHash }` — never drafts, never another operator's doc. Locale fallback `ja`/`zh` → `en`.
- Gated by the same `isOperatorTermsEnabled` server flag (returns 404/empty when off), so the read path is dark in lockstep with the accept path.

### Slice 5 — Atomic acceptance in `submitInTx` (FC/IS)
`services/booking-creation.ts`, around `snapshotAndInsert()`.
- New inputs: `operatorRentalTermsAccepted: boolean`, `operatorRentalTermsAcceptedVersion: string` (P1b — versions are `v1`-style strings; compare **exact string**), and the resolved `locale` (M1).
- **Guarded by the server flag** `isOperatorTermsEnabled` (H1) **and** the booking being renter self-serve DIRECT / non-walk-in (H2). Otherwise: skip entirely.
- **Outside the tx (impure shell):** resolve the operator's PUBLISHED+effective doc in the renter locale (fallback `en`) via `findLatestPublishedVersionForOperator` + `findPublishedOperatorDocument` (exist from Slice A); build the content snapshot (title/body/acceptanceLabel/contentHash/version/locale); **resolve+validate the signing key** here (fail-fast, not in-tx — H3/P1a).
- **Guard (C1):** if `pinned !== latest.version` (exact string) → **422 `OPERATOR_TERMS_CHANGED`**. If a doc exists and the flag is missing/false → **422 `OPERATOR_TERMS_REQUIRED`**.
- **Inside the tx:** re-read latest `(version, locale)` (closes C1's residual race) → insert the booking (yields `bookingId`) → **HMAC-sign** the now-complete field set with the pre-resolved key (P1a — `bookingId` is a signed field) → insert the acceptance row (`bookingId` set, `operatorId` NULL, method `CLICKWRAP`). One `buildRow(snapshot, signature)` helper (M2). No doc → no row. No in-tx idempotency pre-check (L3).
- Replay: `findBookingAcceptance(bookingId, 'OPERATOR_RENTAL_TERMS')` → no-op if present.
- **ErrorCode (P2a):** add `OPERATOR_TERMS_REQUIRED` + `OPERATOR_TERMS_CHANGED` to `packages/shared/src/lib/error-codes.ts` `ERROR_CODES`, emit with `satisfies ErrorCode`, pin in `error-codes.test.ts`.

### Slice 6 — Web modal-on-Reserve
`vite/reservation/PaymentStep.tsx` (Reserve).
- Fetch the operator's published terms via the **Slice 4 read endpoint** (operatorId known from class/vehicle), renter locale.
- Reserve opens the modal when terms exist and are unaccepted; agree → submit `operatorRentalTermsAccepted: true` + `operatorRentalTermsAcceptedVersion` (the **displayed** string version).
- Handle **422 `OPERATOR_TERMS_CHANGED`** (mid-checkout republish): silently re-fetch latest → re-open the modal with the new text → renter re-agrees. Handle **422 `OPERATOR_TERMS_REQUIRED`** the same way (fetch + show).
- The existing inline liability disclaimer checkbox is UNCHANGED (liability stays inline booking cols; operator-terms is the first per-booking LEDGER row in prod).

### Slice 7 — Deploy / observability
- Add `CONSENT_SIGNING_KEY` to the deploy presence check (defense-in-depth; already set for Phase-2 ToS). Missing key must fail deploy, not every booking.
- Add signing observability per H3 so a key/resolve failure is visible.

### Slice 8 — Scope guard
- All behind `VITE_FEATURE_OPERATOR_TERMS` (web) + `isOperatorTermsEnabled` (server), both OFF. No flip.

---

## 5. API contract (Slice B additions)

Booking-create request gains (all optional at the type level; required only under the flag + published-doc condition):

```
operatorRentalTermsAccepted?: boolean
operatorRentalTermsAcceptedVersion?: string   // the `v1`-style version the renter rendered (exact-string pin, P1b)
locale: string                                // resolved renter locale, threaded to submitInTx
```

New renter read endpoint (Slice 4, P1c): `GET /operator-terms/published?operatorId=&locale=`, `requireAuth()` only → `{ version, locale, title, body, acceptanceLabel, contentHash }` for the published+effective doc, or 404/empty when none / flag off. Never returns drafts.

New `ErrorCode`s (P2a — added to `ERROR_CODES`, SCREAMING_SNAKE per house style; `satisfies ErrorCode` at emit, pinned in `error-codes.test.ts`), emitted from the booking path only when flag on + renter self-serve DIRECT + published doc exists:

- `OPERATOR_TERMS_REQUIRED` — a published doc exists but the accept flag is missing/false.
- `OPERATOR_TERMS_CHANGED` — `operatorRentalTermsAcceptedVersion !== latest` (exact string) at submit.

`POST /consent/accept` rejects `OPERATOR_RENTAL_TERMS` (unchanged from baseline — booking-path only).

---

## 6. Data / schema (unchanged from baseline)

- Acceptance row keeps **`operatorId = NULL`**; the operator is recovered by `documentId → consent_documents.operatorId` join (architect key decision; OPERATOR_AGREEMENT half of the schema is untouched). `bookingId` is what gets set.
- Written atomically inside `submitInTx`.
- Schema half (seal generalize + CHECK widen, `operatorId` stays NULL) confirmed SOUND by the architect — the predicate math checks out.

---

## 7. Test plan (mutation-resistant)

- Real-pg for the generalized seal (23505) and widened CHECK (23514).
- **C1:** version-pin — `pinned === latest` seals the exact string version; `pinned !== latest` → 422 `OPERATOR_TERMS_CHANGED`, no row written; the in-tx re-read catches a republish between resolve and insert.
- **H1 (narrowed, P2b):** flag OFF → no require, no 422, no row even when a published doc exists (incl. the authoring-API operator case). Publish is NOT gated (Slice A behavior preserved) — so no publish-off/publish-on tests.
- **H2:** MANUAL / walk-in booking with the operator's own published terms → no 422, no require.
- **H3/P1a:** the key is resolved+validated OUTSIDE the tx (a missing/invalid key fails before the tx opens, never mid-tx and never coupling availability to the secret); the HMAC sign runs INSIDE the tx after insert with the pre-resolved key, and the signed record includes the real `bookingId`; deploy presence check red when key absent.
- **P1c renter read:** any authenticated renter reads the published doc; drafts are never returned; returns empty/404 when the flag is off or no doc exists; one operator cannot read another's via the param.
- **P2a error codes:** `OPERATOR_TERMS_REQUIRED` / `OPERATOR_TERMS_CHANGED` pinned in `error-codes.test.ts`; the web distinguishes them by `body.code`.
- Idempotency: two per-booking consent types coexist on one booking; re-accept is a no-op returning the matching-type row.
- i18n fallback: `ja`/`zh` → `en` when no localized doc.
- Authz: renter cannot mint `OPERATOR_RENTAL_TERMS` via `POST /consent/accept`.
- Pure units: the resolver and the `submitInTx` snapshot/sign path (FC/IS split makes both directly testable).

---

## 8. What is NOT in this slice

- No GA flip. Both flags stay OFF; enabling is Path-to-GA #1476.
- No change to the existing inline liability disclaimer.
- No operator-authoring changes (Slice A owns those).
- No `thread_operator_state`-style state table; nothing messaging-related.

---

## 9. Residual risk / open items

- **Server flag mechanism:** H1 needs a concrete `isOperatorTermsEnabled` source (env vs runtime flag). Recommend mirroring the existing runtime-flag pattern so GA is an owner self-serve flip, consistent with MESSAGING. Confirm during writing-plans.
- **Locale threading (M1):** must be the *resolved* locale the client rendered, not re-derived server-side, or the pin's locale half can drift. The pin carries `(version, locale)` together.
- **Exact line numbers:** the code map predates #1511; writing-plans re-confirms positions against the live tree.

---

## 9b. Planning deltas (discovered during writing-plans, 2026-07-09 — verified vs `develop`)

Refinements found while extracting exact signatures. None reverse an owner decision; each makes a slice concrete.

1. **Gate on `ctx.role === 'RENTER'`, NOT `source === 'DIRECT'` (H2 sharpened).** `resolveBookingActor` (`services/booking-actor.ts:47`) forces `source='DIRECT'` for renters **and** api-key PARTNER callers, so `DIRECT` over-includes PARTNER. `ctx.role === 'RENTER'` (on `CallerContext`, available in `submitInTx`) is the faithful predicate — it cleanly excludes walk-ins, manual/operator bookings, and PARTNER. This also keeps parked PARTNER code untouched.
2. **Locale comes from the request body**, threaded `create()` → `submitInTx` → `snapshotAndInsert`. The booking path never loads the renter `User` row (and the field is `User.language`, not `locale`); there is no `ctx.locale`. Add `locale` to `CreateBookingCommon`; the web already sends its path locale.
3. **`consentRepo` joins `TransactionRepos` as a narrowed `Pick`** (`'findBookingAcceptance' | 'createAcceptance' | 'findLatestPublishedVersionForOperator' | 'findPublishedOperatorDocument'`), constructed `new DrizzleConsentRepository(txDb, sentinelRunTx)` in the drizzle tx factory (`repositories/drizzle/transaction.ts`) **and** both in-memory builders (`composition/repositories.ts` `buildInMemoryRepos` + `buildOverrideRepos`). Those 4 methods use `this.db` only (never `runTransaction`), so a throwing sentinel `runTx` is safe — this is how M4 lands (Pick narrowing, no sentinel reached).
4. **Acceptance-row field names:** rows are `NewConsentAcceptance` — the snapshot is **`documentSnapshot: DocumentSnapshot`** (jsonb `{version, locale, title, body, acceptanceLabel, contentHash}`), the signature is **`recordSignature`** (+ `signingKeyId`, `signatureCanonicalVersion`). `consent_acceptances` has NO version/locale/contentHash columns. Extract `services/consent.ts` `buildRow` + `signAcceptanceRecord` into a shared pure helper reused by the accept path and the booking path (M2).
5. **Shape-check + reject:** `services/consent.ts` shape-check becomes total (M3) — `OPERATOR_RENTAL_TERMS` is a booking-scoped (`CONSENT_CARDINALITY` `PER_EVENT`) type needing `bookingId NOT NULL, operatorId NULL`. `POST /consent/accept` early-rejects `OPERATOR_RENTAL_TERMS` (booking-path only). In-memory `assertUnique` must key on `(bookingId, consentType)` — keying on `bookingId` alone would wrongly reject a second, different-type row on the same booking once the seal is generalized.
6. **Web: `operatorId` is NOT available at `PaymentStep`** (SPECIFIC `AvailableVehicleData` has no `operatorId`). Thread `detail.storefront.operatorId` from the route loader (`routes/$locale/_renter/bookings/new.tsx`) → `ReservationWizard` prop → `PaymentStep` prop. Reusable pieces confirmed: modal `@/components/ui/dialog` (90dvh, inner scroll region), `useFeatureFlag('OPERATOR_TERMS')` (runtime flag already registered), `useLocale()` / the existing `locale` prop.
7. **Seal rename touches 3 literal sites in lockstep** — schema (`packages/shared/src/db/consent.ts`), real-pg test (`tests/integration/consent-records.test.ts`), in-memory `assertUnique` + its unit test. Rename BOTH the unique index (`consent_unique_booking_type`) and the CHECK (`consent_booking_type_chk`), since the widened CHECK is no longer liability-only. Migration via drizzle-kit: edit schema → `bun run db:generate` emits `0107_*.sql` + `drizzle/meta/0107_snapshot.json` + `_journal.json` (verify the emitted SQL, patch the partial-index `WHERE` if needed).
8. **DI + in-tx resolution (plan review round, 2026-07-09).** `BookingService` (built at `index.ts:417`) has no consentRepo/signing/flag today, and `operatorId` is resolved INSIDE `submitInTx` — so the doc-resolution + pin-check move INSIDE the tx (before the booking insert); only the signing KEY resolves outside (fail-fast, needs no operatorId). This makes C1's residual-race re-read UNNECESSARY — the single in-tx resolve is authoritative (H3's real concern, the key throw aborting the tx, is still handled by resolving the key outside). `BookingService` gains two injected thunks: `getSigningKey` (`= resolveSigningKey`) and `isOperatorTermsEnabled` (`= () => featureFlagsService.isEnabled('OPERATOR_TERMS')` — the existing server `FeatureFlagsService`, `serverDefault: false`, gating the require-branch AND the new `GET /operator-terms/published` endpoint). The booking request schema lives in `packages/shared/src/validators/booking.ts` (Zod strips unknown keys → fields must be added there).

## 10. Next step

Owner review of this addendum → on approval, invoke `superpowers:writing-plans` to turn Slices 1–8 into a TDD implementation plan → implement on a fresh `feat/consent-slice-b` worktree off `origin/develop`.
Merge per house rules: no force-push (husky), strict up-to-date, squash (not `--admin`).
