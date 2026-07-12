# ADR-0001: Replace consent HMAC record-signing with DB-enforced append-only storage

- **Status:** Accepted (pending implementation) — contingent (see Decision Outcome)
- **Date:** 2026-07-12
- **Deciders:** owner (Jack); reviewer (round 1)
- **Issue:** #1553 (supersedes #1552)
- **Supersedes:** design spec §9 "Tier-1 record signing" (2026-06-15); Phase 1 plan owner decision "HMAC-SHA256" (2026-06-15)
- **Obsoletes on ship:** signing runbook; deferred issues #1049, #1050

---

## Context and problem statement

The consent ledger signs every acceptance with an HMAC-SHA256 (`recordSignature` + `signingKeyId`) keyed by the app-env secret `CONSENT_SIGNING_KEY`, and an admin evidence-export subsystem recomputes that HMAC to verify records.
The signature is symmetric, so it provides tamper-evidence but **no non-repudiation**, and `resolveSigningKey()` throws in production when the secret is absent, which 500s every booking on the terms path (the sole reason #1552 exists).

The question is whether to keep the HMAC or drop it and rely on the keyless `contentHash` + `documentSnapshot` already stored.

Review round 1 corrected two premises the original "drop" lean rested on, both verified against the code:

1. **There can be published documents and signed rows.**
   Production is migrations-only, but `seed.ts:381` publishes 12 consent documents in any seeded environment, after which renters can create signed acceptances.
   A destructive migration cannot assume zero rows.

2. **The ledger is not DB-enforced append-only.**
   There is no `REVOKE`, trigger, or rule on `consent_acceptances`; the `onDelete:'restrict'` FKs (`db/consent.ts:59-84`) protect *referenced* rows, not the acceptances, and seed cleanup deletes acceptance rows directly (`seed-bookings.ts:167`).
   Today the app role can freely `UPDATE`/`DELETE` acceptances.

Consequence of (2): the HMAC currently carries **one real, unique control** — detecting a silent row edit by a DB-layer attacker (SQL-injection, leaked DB credential, rogue/erroneous DBA, console edit) who cannot read the app-env secret.
Dropping the HMAC without replacing that control would leave an avoidable integrity gap in a legal evidence ledger.

---

## Decision drivers

- Legal evidence ledger: row-binding integrity (who/when/which-doc) must be tamper-evident, not merely conventionally append-only.
- No non-repudiation is achievable with a symmetric secret; only asymmetric keys would give it, and that is not required today (YAGNI).
- Operational safety: eliminate the `CONSENT_SIGNING_KEY`-absent production 500.
- Simplicity: prefer the smallest mechanism that actually delivers the required integrity property.

---

## Considered options

- **A — Keep the HMAC as-is.**
- **B — Drop signing; keyless verification only; accept the row-binding gap.**
- **C — Drop signing; enforce append-only storage at the database (keyless), shipped together.** *(chosen)*
- **D — Replace the HMAC with an asymmetric signature (Ed25519).**

---

## Decision outcome

**Chosen: Option C**, framed contingently:

> Accept dropping HMAC record signing, **contingent on replacing its remaining useful property (DB-layer row-tamper detection) with DB-enforced append-only protection in the same implementation effort.**

Rationale: the symmetric HMAC is not the right long-term tool (no non-repudiation, prod-500 hazard, shared secret), but its one live control must not be dropped and merely deferred to a follow-up.
DB-enforced append-only is keyless, unforgeable by the application path, and is the correct tool for ledger integrity.
Keyless evidence plus hard append-only storage, shipped together, is the clean target.

### Implementation order (mandated)

1. **Add DB append-only hardening for `consent_acceptances`** via **role separation (decided 2026-07-12):**
   the application runtime connects as a reduced-privilege, **non-owner** role with `INSERT`/`SELECT` only on `consent_acceptances` (a non-owner role so `REVOKE UPDATE, DELETE` actually binds — owners keep implicit privileges).
   The privileged owner role (migrations) is the break-glass path for GDPR erasure and corrections.
   This is keyless and unforgeable by the app path even under arbitrary-SQL injection, which the lighter trigger + session-flag guard is not (the same role could flip the flag) — so the trigger approach was considered and rejected for a legal ledger, though a `BEFORE UPDATE OR DELETE` trigger may still be added as defense-in-depth.
   Deploy-time HITL: provision the runtime role in Neon and split `DATABASE_URL` (runtime) from the owner/migration URL before this ships.
2. **Fix seed/test cleanup** to use the explicit privileged/dev break-glass path (so fresh `db:migrate` + seed still works).
3. **Keyless evidence changes:** rename the verify status (`SNAPSHOT_VERIFIED` / add an evidence-level; mark row-binding as *not cryptographically verified*); migration **preflight count/abort-or-export** before any destructive step; **preserve a canonical-version marker** (`contentCanonicalVersion`, or fold `{algorithm, canonicalVersion}` into `documentSnapshot`, since `computeContentHash()` uses the versioned `_canon:v1` path at `consent-canonical.ts:13`).
4. **Then drop** the HMAC columns, `CONSENT_SIGNING_KEY` secret, `consent-signing.ts`, and HMAC verification.

Re-introduce signing only against an asymmetric primitive (Option D) as a fresh scoped change, if third-party-verifiable consent ever becomes a real requirement.

---

## Consequences

**Good**
- Row-binding integrity is enforced keyless at the database, stronger than a symmetric HMAC and without a secret to load/rotate/forget.
- The `CONSENT_SIGNING_KEY`-absent production 500 is eliminated; #1552 is superseded.
- Net removal of a signing service, two backfill scripts, a rotation workflow, and a runbook.
- Document-text tamper-evidence (`contentHash` + `documentSnapshot`) is unchanged.

**Bad / cost**
- Introduces a break-glass path and its discipline; seed, tests, GDPR erasure, and any admin correction must route through it.
- Append-only migration and role/trigger plumbing add moving parts to verify on a fresh migrate.

**Neutral**
- Renter- and operator-facing consent flows are unchanged (dark today regardless).
- No non-repudiation before or after; that was never provided by the HMAC.

---

## Compliance (how we verify the decision is honored)

- A test asserts an ordinary-app-role `UPDATE` and `DELETE` on `consent_acceptances` **fails**, and that the break-glass path succeeds.
- The destructive migration includes a preflight that counts acceptances and aborts (or exports a bundle) if any signed rows exist.
- Evidence-export tests assert the renamed keyless status and that row-binding is reported as not cryptographically verified.
- A test asserts `contentCanonicalVersion` (or snapshot canonical metadata) is persisted and drives verification.
- Fresh `bun run db:migrate` + seed is green on Docker Postgres (guards the append-only trigger/role + break-glass seed path; cf. the drizzle enum-CHECK gotcha).
- `CONSENT_SIGNING_KEY` no longer referenced anywhere (`rg` clean) after the drop.

---

## Pros and cons of the options

- **A (keep):** + keeps row-tamper detection. − symmetric (no non-repudiation), prod-500 hazard, complexity.
- **B (drop, keyless only):** + simplest, removes secret + 500. − leaves a row-binding integrity gap in a legal ledger.
- **C (drop + append-only):** + keyless, unforgeable-by-app row integrity, no secret. − break-glass discipline, seed/test rework. *(chosen)*
- **D (Ed25519):** + real non-repudiation / third-party verification. − YAGNI until an external party requires it; asymmetric key management.

---

## References

- Specs: `docs/superpowers/specs/2026-06-15-consent-ledger-design.md` (§5, §5.1, §9); `docs/superpowers/specs/2026-06-24-consent-evidence-export-design.md`
- Plan: `docs/superpowers/plans/2026-06-15-consent-ledger-phase1.md`
- Runbook (to be obsoleted): `docs/runbooks/2026-06-24-consent-signing-key.md`
- Code: `packages/api/src/services/consent-signing.ts`, `consent-evidence-verify.ts`; `packages/shared/src/db/consent.ts`, `seed.ts:381`, `seed-bookings.ts:167`; `packages/shared/src/lib/consent-canonical.ts:13`
- Issues: #1553 (this), #1552 (superseded), #877 (parent), #1049 / #1050 (deferred, obsoleted)
