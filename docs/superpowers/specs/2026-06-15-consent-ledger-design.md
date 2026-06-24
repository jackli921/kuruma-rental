# Consent Ledger — Design Spec

**Status:** v1.0 — APPROVED (5 review rounds + §9 decisions locked 2026-06-15); ready for implementation plan; NOT yet implemented
**Date:** 2026-06-15
**Author:** design session (Claude + Jack)
**Supersedes/extends:** issue #613 (renter liability disclaimer — the single consent that exists today)

> This file is an untracked draft on the current working checkout. Once approved it will be
> committed on a dedicated feature branch off `marketplace-pivot` and tracked by a GitHub issue.

### Changelog
- **v1.0** — §9 product decisions locked (hard block · Tier-1 signing in Phase 1 · seed/migration
  authoring · `en` fallback · dual-write-then-drop). Architecture approved across 5 review rounds.
  Ready for the implementation plan.
- **v0.6** — review round 5 (no findings): added explicit FK-covering indexes
  (`(documentId, consentType)`, `operatorMembershipId`) for FK lookup performance + the repo's FK-index lint.
- **v0.5** — review round 4: composite FK `(documentId, consentType) → consent_documents(id, type)` so
  the denormalized `consentType` cannot contradict the referenced document's `type` (DB sync seal);
  resolved the dangling render-version note (a material renderer change is republished under a new
  `version`, not a separate field).
- **v0.4** — review round 3 (no P1s): denormalized immutable `consentType` snapshot + `CHECK`
  constraints so the subject-shape / idempotency invariant is DB-enforced, not service-promised; accept
  endpoint's own authz spelled out (self only, published/effective docs only, bindable operator only);
  added `acceptanceLabel` and widened `contentHash` to the full "what they were shown" artifact.
- **v0.3** — review round 2: replaced the impossible `type`-predicated partial index with three disjoint
  subject-keyed unique indexes; API-gate allowlist + role matrix; once-per-subject idempotency seals;
  explicit `ON DELETE RESTRICT` + deferred pseudonymization; `IMPORTED` timestamp exception.
- **v0.2** — review round 1: API-layer enforcement (not just web gate); booking-liability acceptance
  inside the booking transaction; typed `bookingId` FK; cohort-first re-consent; operator-authority
  evidence; signing canonicalization + DB guards.
- **v0.1** — initial two-table ledger design.

---

## 1. Problem

The platform captures exactly **one** consent today — the renter liability disclaimer — as two
inline columns on `bookings` (`disclaimerAcknowledgedAt` + `disclaimerTermsVersion`), with the
wording itself living in i18n JSON and referenced only by a date-version string. That pattern does
not scale and does not meet the real need:

- We must capture **multiple consent types** (renter ToS, privacy policy, operator platform
  agreement, the existing booking disclaimer, plus future cookie/marketing/GDPR consents).
- We must be able to **present a copy** of exactly what each operator and each new user agreed to —
  to that party, and as evidence in a dispute.
- The existing approach stores **no text**, sprawls a column-pair per type, and has no audit trail.

### Audiences with nothing today
- **Operators** — invite acceptance is tracked (`providerInvites.acceptedByUserId`), but there is
  **no** platform/commission-agreement acceptance on `operators` or `operatorMemberships`.
- **New users** — `users` has **zero** ToS/privacy columns; OAuth signup creates the row with no gate.

## 2. Decisions already agreed (the "go")

1. **Approach A — one generalized two-table ledger**, chosen over (B) per-domain columns and
   (C) buying a CMP/e-sign vendor.
2. **Exact-text-per-version** storage — the legal text is archived per version+locale so a copy is
   always reproducible. GDPR Art. 7 "demonstrable consent" + clickwrap-enforceability standard.
3. **Clickwrap now, operator e-sign deferred** behind a seam (not a one-way door).

## 3. Anchors (why this shape)

- **GDPR Art. 7(1) / Japan APPI** (https://www.ppc.go.jp/en/legal/) — must demonstrate *who* consented,
  *when*, and *what they were shown*.
- **Clickwrap enforceability** — to enforce "I agree" you must produce the exact version shown + proof
  of assent. Git history is not a clean substitute (source template, not rendered output; mutable).

## 4. Core schema

New bounded-context file `packages/shared/src/db/consent.ts`; enums in `enums.ts`; migration via the
standard `db:generate → db:migrate → db:verify` flow.

### `consent_documents` — versioned, immutable once published
| column | type | notes |
|---|---|---|
| `id` | text pk | seed-id convention |
| `type` | enum `consent_type` | RENTER_TOS · PRIVACY_POLICY · RENTER_LIABILITY · OPERATOR_AGREEMENT · … |
| `version` | text | e.g. `'1.0'` or `'2026-06-13'`; monotonic per type |
| `locale` | text | `en` · `ja` · `zh` |
| `title` | text | display title — part of the disclosure |
| `body` | text | **full rendered legal text** (markdown); the source of truth |
| `acceptanceLabel` | text | the exact assent text shown by the checkbox (e.g. "I have read and accept the Terms of Service") — part of the disclosure |
| `contentHash` | text | `sha256` over the canonical disclosure artifact `(title, body, acceptanceLabel)` — see §5.1; unique per version+locale |
| `status` | enum `consent_doc_status` | DRAFT · PUBLISHED · ARCHIVED (only PUBLISHED is acceptable) |
| `effectiveFrom` | timestamptz | when this version takes effect |
| `publishedAt` | timestamptz null | set at publish |
| `createdAt` / `updatedAt` | timestamptz | |

- **Unique** `(type, version, locale)`.
- **`UNIQUE (id, type)`** — redundant (`id` is PK) but it is the target the acceptance composite FK
  points at, so a denormalized `consentType` can never diverge from the document's real `type`.
- **Immutability rule:** once `status = PUBLISHED`, `body`/`title`/`acceptanceLabel`/`contentHash` never
  change — new wording = a new version row. Enforced in the service **and** (recommended hardening,
  §4.3) at the DB level.

### `consent_acceptances` — append-only ledger
| column | type | notes |
|---|---|---|
| `id` | text pk | |
| `documentId` | text fk → consent_documents | pins the **exact** version+locale accepted; FK is **composite** with `consentType` (§4.1 sync seal) |
| `consentType` | enum `consent_type` | **denormalized immutable snapshot** of the document's type. Kept honest by the **composite FK** `(documentId, consentType) → consent_documents(id, type)`, so it cannot contradict the referenced document |
| `userId` | text fk → users | the human who clicked |
| `operatorId` | text fk → operators · null | the bound entity for operator agreements |
| `operatorMembershipId` | text fk → operator_memberships · null | **why** this user could bind the operator |
| `actorRole` | text null | snapshot of the actor's role at acceptance time (membership status is mutable) |
| `bookingId` | text fk → bookings · null | **typed** link for per-booking consent; populated **only** on liability rows (CHECK-enforced, §4.1); indexed |
| `acceptedAt` | timestamptz | **server-stamped** for live CLICKWRAP/ESIGN; for `method=IMPORTED` it is the **source event time** (§6C) |
| `context` | jsonb null | **supplemental metadata only** (`{flow:'SIGNUP'}`, etc.) — never the primary FK |
| `ipAddress` | text null | request metadata (evidence) |
| `userAgent` | text null | request metadata (evidence) |
| `method` | enum `consent_method` | CLICKWRAP (default) · ESIGN · IMPORTED |
| `recordSignature` | text null | **Tier-1** server signature over the canonical payload (§5) |
| `signingKeyId` | text null | which platform key signed it (rotation) |
| `signatureRef` | text null | **Tier-2** external e-sign envelope id (DocuSign), for `method=ESIGN` |
| `createdAt` | timestamptz | row insert time (= import time for IMPORTED rows) |

### 4.1 Sync seal + row-shape CHECKs + idempotency (DB-enforced, not service-promised)
A composite FK `(documentId, consentType) → consent_documents(id, type)` guarantees the snapshot
`consentType` equals the referenced document's real `type` (sync seal — a copied value is only safe when
the DB proves it matches the source). Given that, the denormalized `consentType` lets the database
enforce the type↔subject mapping, so "`bookingId` only on liability rows" / "`operatorId` only on
operator-agreement rows" is a DB invariant, not a convention:
- `CHECK ((consentType = 'RENTER_LIABILITY') = (bookingId IS NOT NULL))`
- `CHECK ((consentType = 'OPERATOR_AGREEMENT') = (operatorId IS NOT NULL))`
- `CHECK (operatorMembershipId IS NULL OR operatorId IS NOT NULL)` — a membership implies an operator.

A malformed row (both `bookingId` and `operatorId` set, or a liability row with no `bookingId`) is
rejected. On top of that shape, three **disjoint** partial unique indexes seal idempotency:
- **Per-booking liability:** `UNIQUE (bookingId) WHERE bookingId IS NOT NULL`.
- **Once-per-user (RENTER_TOS, PRIVACY_POLICY):** `UNIQUE (userId, documentId) WHERE bookingId IS NULL
  AND operatorId IS NULL`.
- **Once-per-operator (OPERATOR_AGREEMENT):** `UNIQUE (operatorId, documentId) WHERE operatorId IS NOT NULL`.

Disjoint by populated subject column (now CHECK-guaranteed), so each row is sealed by exactly one index.
Retry-clicks collapse onto the existing row. (`documentId` pins version+locale, so a new version is a
different row — re-consent history, not a dup.)
- **FK-covering indexes (repo FK-index lint):** the partial uniques cover `bookingId`/`userId`/
  `operatorId` as leading columns, but not every FK path — add explicit indexes on
  `(documentId, consentType)` (covers the composite FK + bare `documentId` lookups) and
  `operatorMembershipId`.
- **Append-only:** no updates/deletes on acceptances.

### 4.2 Consent cardinality (code config, not a column)
A small const map records whether a type is accepted **once per subject** (RENTER_TOS,
PRIVACY_POLICY, OPERATOR_AGREEMENT) or **per event** (RENTER_LIABILITY = once per booking). Used by the
re-consent query. KISS — derived config, not stored state.

### 4.3 Integrity guards (recommended hardening, phase-able)
Beyond service-level enforcement: a DB trigger / restricted grants making `consent_acceptances`
no-UPDATE/no-DELETE and `consent_documents` no-UPDATE-once-PUBLISHED. Service guards + the unique
constraints cover the common cases; DB guards are belt-and-suspenders for the legal claim — worth doing,
not blocking Phase 1.

### 4.4 FK & deletion policy (legal ledger)
All subject FKs (`documentId`, `userId`, `operatorId`, `operatorMembershipId`, `bookingId`) are
**`ON DELETE RESTRICT`** — matching the house convention (#728) and fail-loud for an evidence table: you
cannot hard-delete a user/operator/booking that carries consent evidence. GDPR right-to-erasure is
handled by **pseudonymization** (scrub PII on the subject; retain the acceptance row + signed hash as the
legal record), **deferred** until a real erasure request exists — the signed payload + `actorRole`
snapshot keep the record meaningful after the subject is anonymized.

## 5. Digital signature — two tiers (bound to the versioned document)

- **Tier 1 — cryptographic record signature (recommended, include now).** On every acceptance the
  server signs a **canonical payload** and stores `recordSignature` + `signingKeyId`. Tamper-evident,
  independently verifiable, no vendor. Because the payload includes `contentHash` (version+locale-
  specific), the signature *is* the document-versioned-with-signature.
  - **Canonical serialization (must be deterministic):** RFC 8785 JCS over an explicit field set, or a
    length-prefixed concatenation. **Signed fields:** `documentId, contentHash, consentType, version,
    locale, userId, operatorId, operatorMembershipId, bookingId, method, acceptedAt` — and `ipAddress`,
    `userAgent` if claimed as tamper-evident. Key in CF secrets; `signingKeyId` enables rotation.
- **Tier 2 — e-signature ceremony (deferred seam).** User-drawn/typed signature → signed PDF via
  DocuSign/PandaDoc for operator contracts. Lives behind `method=ESIGN` + `signatureRef`. Build only
  when a real operator demands a countersigned copy.

### 5.1 What `contentHash` covers
`contentHash = sha256(canonical(title, body, acceptanceLabel))` — the full disclosure a subject was
shown, not just the body. Markdown→HTML rendering is a **deterministic pure function of `body`**, so
hashing the source is equivalent to hashing the rendered output. The legal claim is scoped to that source
artifact; a material change to the in-house Markdown renderer is handled by **republishing affected
documents under a new `version`** (the existing `version` field is the carrier — no separate
render-version field, YAGNI for a stable renderer).

## 6. Flows

### A. Renter ToS + Privacy — web gate (UX) **and** API gate (policy)
- **Web (UX):** on first authenticated load, run the re-consent query for `RENTER_TOS` +
  `PRIVACY_POLICY`; if not current → blocking clickwrap screen.
- **API (policy — required):** a `ConsentGateService` / middleware rejects **protected mutations** for a
  subject who is not current, with `403 CONSENT_REQUIRED`, generalizing the existing booking-route
  `RENTER → 400 CONSENT_REQUIRED` check. The browser is not a trust boundary — a stale tab, mobile
  client, or direct API caller must be refused server-side.
- **Gate scope (allowlist, not "all"):** exempt the **consent-accept endpoint itself** (else acceptance
  deadlocks), **auth/session routes**, and **read-only GETs**. `PARTNER` API-key callers (Trip.com) are
  **not** subject to the user-clickwrap gate — their consent is the B2B partner/operator agreement (a
  machine contract), not a per-request checkbox. Net: the gate applies to authenticated `RENTER`/
  operator-role **write** routes; everything else is allowlisted. A short route×role matrix ships with
  the service.
- **Accept endpoint still self-authorizes** (gate-exempt ≠ unguarded): accept **only as the current
  user**; **only** documents that are currently `PUBLISHED`/effective (never a DRAFT, ARCHIVED, or
  arbitrary old version); and `OPERATOR_AGREEMENT` **only** for an operator the user can bind via an
  **active** membership. On accept → one acceptance row per document (server-stamped + Tier-1 signed).

### B. Operator agreement at onboarding
- When a user accepts a provider invite / activates their first operator membership → require
  `OPERATOR_AGREEMENT` acceptance with `operatorId`, `operatorMembershipId`, and `actorRole` set.
  The API consent gate blocks operator-scoped mutations until accepted (not just a dashboard redirect).

### C. Booking liability disclaimer — migrate the existing consent in (single transaction)
- **New bookings:** the `RENTER_LIABILITY` acceptance is written **inside `submitInTx`**, on the same
  `repos` bundle as `bookingRepo.create` and `bookingEventRepo.append(BOOKING_CREATED)` — one atomic
  commit. A mid-request failure or code-collision replay re-runs the whole insert; the
  `unique(bookingId)` seal makes it idempotent. The acceptance references the published
  `RENTER_LIABILITY` document version+locale and becomes the source of truth.
- **Backfill:** seed a `RENTER_LIABILITY` document for version `'2026-06-13'` (text from current i18n),
  then create `method=IMPORTED` acceptance rows for every existing booking with
  `disclaimerAcknowledgedAt`. For imported rows `acceptedAt` = the historical source event time and
  `createdAt` = import time; no signature on imported rows.
- **Transition:** keep `bookings.disclaimer*` columns dual-written for one release, then drop (Phase
  decision — see open questions).

## 7. Re-consent gate (cohort-first, locale-safe)
"Needs re-consent?" is a **query**, never stored state (can't drift):
1. For the subject's role, take the required once-per-subject types.
2. For each type, select the **latest required `(type, version)` cohort first** — independent of locale.
3. Resolve the subject's locale row within that version (or fall back to `en` / block — see Q4).
4. The subject is current iff they have an acceptance row for that latest **version** (any accepted
   locale of it counts as consent to that version).

This prevents `ja`/`zh` lagging `en`: a user can't be "current" on an older version just because their
locale's newest text hasn't been published.

## 8. Out of scope / deferred (YAGNI)
- E-signature ceremony UI / DocuSign integration (seam only).
- Cookie-consent banner, marketing opt-in, GDPR data-processing portal — future `consent_type` values,
  **no schema change** needed to add them.
- Self-serve document authoring UI (seed/migration-managed is fine for MVP — see Q3).
- GDPR erasure pseudonymization job (see §4.4) — until a real request exists.

## 9. Product decisions (LOCKED 2026-06-15)
1. **Re-consent enforcement → hard block** (API gate is required either way; this sets UX severity).
2. **Tier-1 record signing → build in Phase 1** (cheap; retrofitting leaves early rows unsigned).
3. **Document authoring → seed/migration** (git-auditable; admin UI is YAGNI).
4. **Missing-locale behaviour → fall back to `en`** (never break a real signup/booking; record the
   exact `documentId` shown).
5. **Booking-disclaimer migration → dual-write one release, then drop** (verify ledger in prod first;
   matches post-#27 migration caution).

## 10. Phasing (proposed)
- **Phase 1:** schema + enums + repos & service (incl. `ConsentGateService` + Tier-1 signing); seed
  RENTER_TOS, PRIVACY_POLICY, OPERATOR_AGREEMENT, RENTER_LIABILITY documents (en/ja/zh).
- **Phase 2:** renter ToS/privacy — web gate + API gate (Flow A).
- **Phase 3:** operator agreement gate (Flow B).
- **Phase 4:** migrate booking disclaimer into the ledger + backfill (Flow C).
- Each phase is a vertical slice with its own tests; Tier-2 e-sign is not in any phase.

## 11. Review status
Four external review rounds (2026-06-15). R1 approved the direction; R2 fixed the impossible index +
gate / idempotency / FK gaps; R3 hardened row-shape enforcement, accept-endpoint authz, and the
disclosure hash; R4 added the composite-FK sync seal for `consentType` + resolved the render-version
note; R5 (no findings) noted FK-covering indexes for the lint. All incorporated through v1.0 —
**architecture is approved and the §9 product decisions are locked (2026-06-15)**. Ready for the
implementation plan (writing-plans) → GitHub issue → TDD vertical slices, Phase 1 first.
