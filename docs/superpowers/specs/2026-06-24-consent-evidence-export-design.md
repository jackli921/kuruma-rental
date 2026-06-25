# Consent Evidence Export — Design

> Status: DRAFT for review · 2026-06-24 · Refs #877 (consent ledger), follows #1048 (signing key wired)

## Problem

The consent ledger signs each acceptance with an HMAC (`recordSignature` + `signingKeyId`)
over the document content the user saw. But the acceptance row only references the **live**
`consent_documents` row by `documentId`; it does **not** store the version or text that was
shown. `consent_documents` is mutable in place (PK = `id`, `updatedAt`, seed uses
`onConflictDoUpdate`). So if a document is ever edited:

- old acceptances would render **today's** text, not what the user actually agreed to, and
- the stored signature (computed over the original content hash) would no longer verify, with
  the original text already lost.

The owner's goal is **"proof when needed" via a clean export** — on demand, produce a
complete, faithful, human-readable evidence record for any acceptance. That requires each
acceptance to reproduce *exactly* what was agreed, independent of later document edits.

## Goals

- Each acceptance is a **self-contained evidence record**: signature + exact version/text +
  timestamp + actor + request metadata, frozen at accept time.
- An on-demand **export** that assembles the bundle and **re-verifies** the signature against
  the frozen snapshot (not the live, mutable document).
- Drift between the snapshot and the live document is a **detectable, explainable fact**, never
  silent corruption.

## Non-goals (explicit YAGNI cuts)

- **No asymmetric signatures / Ed25519.** Owner chose export over third-party-verifiable crypto.
  The existing HMAC (Tier-1) stays; an asymmetric swap remains a future option if an external
  party ever must verify without trusting us.
- **No external timestamp authority / transparency log / hash-chaining.** Not defending against
  the "you fabricated/backdated it" accusation in this iteration.
- **No PDF rendering.** Structured JSON export is sufficient; a printable view can come later.

## Approach (chosen: A — snapshot full text)

### Data model

Two new columns on `consent_acceptances`:

| Column | Type | Notes |
|--------|------|-------|
| `documentSnapshot` | `jsonb` (nullable) | `{ version, locale, title, body, acceptanceLabel, contentHash }` captured at accept time. |
| `signatureCanonicalVersion` | `text` (nullable) | The `_canon` version (`CANONICAL_VERSION`) embedded in the signed bytes at sign time, **stored explicitly** so a future v2 verifier re-canonicalizes byte-identically instead of guessing/trying versions. Null on legacy rows ⇒ assume the sole historical version. (Delivers part of #1050's groundwork.) |

- `documentSnapshot` is one atomic column, not six loose ones — clearly "the snapshot of what was shown."
- Both are **nullable** because existing rows predate them. A null `documentSnapshot` unambiguously
  means "legacy, pre-snapshot"; every new acceptance populates both.
- The snapshot's `contentHash`/`version`/`locale` are in the signed set; the raw `title`/`body`/
  `acceptanceLabel` bind to the signature only *through* `contentHash` (enforced by verification
  gate 2) — so snapshot and signature stay **consistent by construction**.

### Capture flow (no new moving parts)

`ConsentService.recordAcceptance` already loads the document (to check `PUBLISHED` and to
compute the HMAC over its content). At that point it holds `version`/`locale`/`title`/`body`/
`acceptanceLabel`/`contentHash` — it writes them into `documentSnapshot` on the same insert, and
records the `CANONICAL_VERSION` used by the signer into `signatureCanonicalVersion`.
`NewConsentAcceptance` gains both fields; `InMemory` and `Drizzle` consent repos persist them. The
signer's canonical-form logic is unchanged — we only *capture* the version tag it already embeds.

### Backfill

One-time idempotent script `db:backfill-consent-snapshot`. "Join the current document and write
the snapshot" is unsafe on its own: the seed uses `onConflictDoUpdate` for `title`/`body`/
`contentHash` and advances `updatedAt` (`seed.ts`), so if wording ever drifted, naive backfill
would **manufacture false evidence**. The script therefore writes a snapshot for a null-snapshot
row **only when it can prove the current document still matches what was accepted**:

1. **Source-doc self-consistency pre-gate (runs first):** verify the current document is internally
   consistent — `computeContentHash(currentDoc.title, body, acceptanceLabel) === currentDoc.contentHash`.
   If it fails, the live row's text and its own hash already disagree (e.g. a body edit that left a
   stale `contentHash`), so the artifact can't be trusted as the source of a snapshot → **skip** as
   `skipped-current-doc-hash-mismatch`. This must precede the HMAC gate, because the HMAC is computed
   over the *stored* `contentHash`, not the raw text — without this pre-gate the HMAC could pass
   while the displayed text is wrong.
2. **Signed rows (the strong gate):** recompute the HMAC over the current document's `contentHash` +
   the row's canonical fields, under the row's `signingKeyId`. If it equals `recordSignature`, then —
   *given the pre-gate passed* — current text → current `contentHash` → signed `contentHash` all
   chain, so the current document is provably the disclosure artifact that was signed → safe to
   snapshot. If it does **not** match → the document drifted → **skip** as `skipped-hash-mismatch`.
3. **Unsigned rows** (`recordSignature` null): no cryptographic proof is available → **skip**,
   never guess.
4. **Timestamp drift = audit metadata, not a veto.** Consent seed upserts set `updatedAt = now` on
   every reseed even when content is byte-identical (`seed.ts`), so `updatedAt` drift does **not**
   imply tampering. The gate-2 HMAC match is authoritative: when it passes, the row is backfilled
   even if `updatedAt > acceptedAt`, and the drift is recorded as audit metadata on the report.
   `updatedAt` is never allowed to override a passing signature — crypto beats heuristics.

The script **aborts with a report** (backfilled [with/without timestamp-drift noted] /
`skipped-current-doc-hash-mismatch` / `skipped-hash-mismatch` / `skipped-unsigned`) rather than
silently completing, so the operator sees exactly what was and wasn't reconstructed. Skipped rows
stay `null` and surface as `SNAPSHOT_MISSING` in the export — an honest gap, not fabricated text.

## Export + verification (Section 2)

### Service

`ConsentService.getConsentEvidence(acceptanceId)` → `ConsentEvidence`:

```
ConsentEvidence = {
  acceptance:   { id, userId, actorRole, documentId, consentType,
                  operatorId?, operatorMembershipId?, bookingId?,
                  acceptedAt, method, ipAddress?, userAgent? },
  document:     { version, locale, title, body, acceptanceLabel, contentHash } | null,  // null = no snapshot
  signature:    { recordSignature, signingKeyId, signatureCanonicalVersion },
  verification: { status, detail? },
}
```

The record exposes **every field in the signed set** — `documentId`, `contentHash`, `consentType`,
`version`, `locale`, `userId`, `operatorId`, `operatorMembershipId`, `bookingId`, `method`,
`acceptedAt`, `ipAddress`, `userAgent`, `signingKeyId` — plus `signatureCanonicalVersion`. So
verification is **replayable from the exported JSON alone** by anyone holding the key:
re-canonicalize those fields under the stored version, HMAC, compare. (`actorRole` is included as
metadata but is *not* in the signed set, so it does not affect verification.)
`operatorMembershipId` in particular records which membership exercised operator authority.

`document` is **nullable**: legacy and intentionally-un-backfilled rows have no snapshot. The
export NEVER falls back to reading the live `consent_documents` row in the `document` slot — that
is the exact silent-substitution bug this design exists to prevent. (A live doc MAY be attached
under a clearly separate `currentDocument` field labelled "current — not what was shown,
unverifiable" if an operator explicitly asks; never in `document`.)

Bundle variants for legal export: `getConsentEvidenceForUser(userId)` and
`...ForBooking(bookingId)` return arrays of the same record.

### Verification semantics

The signed HMAC payload covers `contentHash` (plus `version`/`locale`/record fields) — **not** the
raw `title`/`body`/`acceptanceLabel` (see `consent-signing.ts`). The raw text is bound to the
signature only *through* `contentHash`. So a valid signature alone does **not** prove the exported
text is authentic — the text→hash link must be checked first. Verification is therefore a strict
precedence chain; the **first** failing gate is the reported status:

| order | `status` | Gate |
|---|----------|------|
| 1 | `SNAPSHOT_MISSING` | `documentSnapshot` is null. No authentic text exists to export; stop. |
| 2 | `SNAPSHOT_HASH_MISMATCH` | `computeContentHash(snapshot.title, body, acceptanceLabel) !== snapshot.contentHash`. Snapshot text was altered while the hash was left intact — the displayed text is untrustworthy even if the signature checks out. |
| 3 | `UNSIGNED` | `recordSignature` is null — legacy/IMPORTED row, or written before the key was configured. |
| 4 | `KEY_UNAVAILABLE` | `signingKeyId` is not resolvable (rotated key with no registry; ties to #1050). |
| 5 | `SIGNATURE_MISMATCH` | Recomputed HMAC (re-canonicalized under the row's stored `signatureCanonicalVersion`; null ⇒ sole historical version) `!== recordSignature`. Row altered after signing. |
| 6 | `VERIFIED` | All gates pass: the snapshot text hashes to its `contentHash`, and that hash is bound into a valid signature. |

Only `VERIFIED` may be presented as proof. Every other status is surfaced verbatim in the export
(never hidden) so a reviewer sees exactly why a record fell short. Because verification reads the
snapshot, a `VERIFIED` result is **stable forever** regardless of later edits to
`consent_documents`; a live-doc edit is informational drift, not a verification failure.

### Open question — resolved: keep the HMAC payload over `contentHash`

The signed payload stays as-is (over `contentHash`, not raw text). Rationale: `contentHash` is a
SHA-256 commitment to the text, so verifying *text → hash → signature* is cryptographically
equivalent to signing the text directly, given collision resistance — and it avoids a
signing-format change, keeps every existing signature valid, and composes with the canonical-form
version tag (`_canon`, already present for #1050). **The condition the owner named is mandatory:**
gate 2 (`SNAPSHOT_HASH_MISMATCH`) is first-class and runs before any signature is trusted. If a
future requirement ever needs the raw text signed directly, bump `_canon` to a new version — each
row already records its own `signatureCanonicalVersion`, so the verifier dispatches per-row with no
guessing.

### Surfaces

- **Platform-admin route** `GET /admin/consent/acceptances/:id/evidence` → `ConsentService`.
  Authz: platform admin only (reuses the existing admin auth used by the #932 documents area).
  Renter/operator callers → 403.
- **CLI** `bun run consent:evidence -- <acceptanceId|--user <id>|--booking <id>>` → writes the
  JSON bundle to stdout/file for legal export.

## Architecture / boundaries

- Schema in `packages/shared/src/db/consent.ts` — **danger zone**: `db:generate` → `db:migrate`
  → `db:verify` (3 green checks); CI `db-drift`.
- `ConsentEvidence` type + verification status enum in `@kuruma/shared` (cross-boundary contract).
- `recordAcceptance` snapshot write + `getConsentEvidence*` read in `services/consent.ts`;
  repo methods in `repositories/{in-memory,drizzle}/consent.ts`; route in `routes/` → service
  (no repo import). Follows routes → services → repositories.

## Testing

- **unit** — `recordAcceptance` persists `documentSnapshot` equal to the loaded document; snapshot
  fields match what the signature was computed over.
- **unit** — `getConsentEvidence` returns `VERIFIED` for a freshly signed row.
- **unit (the point)** — after editing the live document, `getConsentEvidence` still returns the
  **original** snapshot text and `VERIFIED` — proves independence from the live doc.
- **unit (P1 hash gate)** — alter `snapshot.body` while leaving `snapshot.contentHash` and a valid
  `recordSignature` intact → `SNAPSHOT_HASH_MISMATCH`, NOT `VERIFIED`. This is the attack the
  text→hash self-check exists to stop.
- **unit (precedence)** — null snapshot → `SNAPSHOT_MISSING` and `document: null` (assert the live
  doc is never substituted into `document`); tampered `recordSignature` → `SIGNATURE_MISMATCH`;
  null signature → `UNSIGNED`; foreign `signingKeyId` → `KEY_UNAVAILABLE`. Assert first-failing-gate
  ordering when several would fail.
- **unit (replayability)** — recompute the HMAC from the exported `ConsentEvidence` fields alone
  (re-canonicalized under `signatureCanonicalVersion`) and assert it equals `recordSignature` — the
  export carries everything needed to replay the proof, no DB read required.
- **integration** — export route authz (platform admin only; renter/operator 403) + bundle shape
  (asserts `documentId`/`consentType`/`operatorMembershipId`/`signatureCanonicalVersion` present).
- **script** — backfill snapshots a row only when the source-doc self-consistency pre-gate passes
  **and** the current-doc HMAC matches `recordSignature`; a content-edited doc → `skipped-hash-mismatch`;
  unsigned rows skipped; idempotent; emits the backfilled/skipped report.
- **script (stale-hash pre-gate)** — a doc whose `body` was edited while `contentHash` was left
  stale (so the HMAC over the stale hash would still pass) → caught by the pre-gate as
  `skipped-current-doc-hash-mismatch`, **never** snapshotted as "safe."
- **script (drift-is-not-veto)** — a harmless reseed that bumps only `updatedAt` (content identical)
  → HMAC still matches → row **is** backfilled, with the timestamp drift noted as audit metadata,
  NOT skipped.

## Deferred / related

- **#1050** keyId→key registry — needed for `VERIFIED` on rows signed under a rotated key
  (otherwise `KEY_UNAVAILABLE`). This export design surfaces the need but does not depend on it.
- **#1049** real-pg constraint test — unrelated but adjacent consent hardening.
- Asymmetric signing / external timestamp anchoring — out of scope; revisit only if a
  third-party-verifiable or anti-backdating requirement appears.
