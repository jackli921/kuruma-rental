# Consent Evidence Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every consent acceptance a self-contained, replayable evidence record — snapshot the exact disclosed text + signed canonical version at accept time, expose a verified export, and backfill legacy rows only when the current document is provably the signed artifact.

**Architecture:** Snapshot (`documentSnapshot` jsonb + `signatureCanonicalVersion`) is written by `ConsentService.recordAcceptance`. A pure `verifyAcceptance()` (Functional Core) runs a strict gate chain (hash-self-check before signature). A new `ConsentEvidenceService` assembles bundles; a platform-admin route + CLI export them. A guarded backfill script reconstructs legacy snapshots.

**Tech Stack:** Bun, Hono (CF Workers), Drizzle + Neon Postgres, Vitest, Zod. Spec: `docs/superpowers/specs/2026-06-24-consent-evidence-export-design.md`.

**Conventions:** API unit tests run with `env -u DATABASE_URL bun run --filter @kuruma/api test`. Schema changes are a danger zone: `bun run db:generate --name <n>` → `bun run db:migrate` → `bun run db:verify` (3 green). Drizzle parity tests run under the real-pg (`db-drift` / e2e-real-db) CI lane. Commit after every green step.

---

### Task 1: `DocumentSnapshot` type + schema columns

**Files:**
- Modify: `packages/shared/src/lib/consent-canonical.ts` (add `DocumentSnapshot`)
- Modify: `packages/shared/src/db/consent.ts` (two columns on `consentAcceptances`)
- Test: `packages/shared/tests/db/consent-schema.test.ts` (extend existing schema test if present, else create)

- [ ] **Step 1: Add the snapshot type.** In `consent-canonical.ts`, after `DisclosureArtifact`:

```typescript
/** The exact disclosure a subject was shown, frozen onto the acceptance (#877 evidence export). */
export interface DocumentSnapshot extends DisclosureArtifact {
  version: string
  locale: string
  contentHash: string
}
```

- [ ] **Step 2: Add the columns.** In `db/consent.ts`, import the type and add to the `consentAcceptances` column object (after `signatureRef`):

```typescript
import type { DocumentSnapshot } from '../lib/consent-canonical'
// ...inside consentAcceptances columns, before createdAt:
    documentSnapshot: jsonb('documentSnapshot').$type<DocumentSnapshot>(),
    signatureCanonicalVersion: text('signatureCanonicalVersion'),
```

Ensure `jsonb` is in the `drizzle-orm/pg-core` import list (it already is — used by `context`).

- [ ] **Step 3: Generate + apply + verify the migration.**

Run: `bun run db:generate --name add_consent_evidence_snapshot && bun run db:migrate && bun run db:verify`
Expected: a new `drizzle/00XX_*.sql` adding both nullable columns; `db:verify` shows 3 green checks.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/lib/consent-canonical.ts packages/shared/src/db/consent.ts drizzle/
git commit -m "feat(#877): add documentSnapshot + signatureCanonicalVersion columns"
```

---

### Task 2: Domain types carry the new fields

**Files:**
- Modify: `packages/api/src/stores.ts:480` (`ConsentAcceptance`)
- Modify: `packages/api/src/repositories/types-consent.ts` (`NewConsentAcceptance`)

- [ ] **Step 1: Extend `ConsentAcceptance`.** In `stores.ts`, add to the interface (after `signingKeyId`):

```typescript
  signatureCanonicalVersion: string | null
  documentSnapshot: import('@kuruma/shared/lib/consent-canonical').DocumentSnapshot | null
```

(If `stores.ts` already imports from that module, use a top-of-file `import type { DocumentSnapshot }` instead of the inline import.)

- [ ] **Step 2: Extend `NewConsentAcceptance`.** In `types-consent.ts`, add after `signingKeyId`:

```typescript
  signatureCanonicalVersion: string | null
  documentSnapshot: DocumentSnapshot | null
```

and add the import: `import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'`.

- [ ] **Step 3: Typecheck (expected to fail loudly where the row is built — that's Task 3/4).**

Run: `bun run --filter @kuruma/api typecheck`
Expected: errors only in `services/consent.ts` (buildRow) and `repositories/drizzle/consent.ts` (`toAcceptance`) for the missing properties. These are fixed next.

- [ ] **Step 4: Commit.**

```bash
git add packages/api/src/stores.ts packages/api/src/repositories/types-consent.ts
git commit -m "feat(#877): consent acceptance types carry snapshot + canonical version"
```

---

### Task 3: Capture the snapshot at accept time

**Files:**
- Modify: `packages/api/src/services/consent.ts` (`buildRow`, ~148-197)
- Test: `packages/api/src/services/consent.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `consent.test.ts`:

```typescript
it('records a documentSnapshot and canonical version matching the signed document', async () => {
  // publishDoc/makeService are the existing helpers in this file; mirror their use.
  const doc = await publishDoc({ type: 'RENTER_TOS', version: 'v1', locale: 'en' })
  const svc = makeService({ getSigningKey: () => ({ key: 'k', keyId: 'v1' }) })
  const res = await svc.recordAcceptance(
    { documentId: doc.id, userId: 'user_1', operatorMembershipId: null, actorRole: 'RENTER' },
    { now: new Date('2026-06-24T00:00:00Z'), ipAddress: '1.1.1.1', userAgent: 'UA' },
  )
  if (!res.ok) throw new Error('expected ok')
  expect(res.acceptance.documentSnapshot).toEqual({
    version: 'v1', locale: 'en', title: doc.title, body: doc.body,
    acceptanceLabel: doc.acceptanceLabel, contentHash: doc.contentHash,
  })
  expect(res.acceptance.signatureCanonicalVersion).toBe('v1') // CANONICAL_VERSION
})
```

- [ ] **Step 2: Run it; confirm it fails.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent.test.ts -t documentSnapshot`
Expected: FAIL (`documentSnapshot` undefined).

- [ ] **Step 3: Implement.** In `consent.ts`: import `CANONICAL_VERSION` (`import { CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'`); widen `buildRow`'s `doc` param type to include `title`, `body`, `acceptanceLabel`; and add the two fields to the returned object:

```typescript
  private buildRow(
    doc: { id: string; type: ConsentType; version: string; locale: string; contentHash: string
           title: string; body: string; acceptanceLabel: string },
    // ...unchanged params
  ): NewConsentAcceptance {
    // ...unchanged through `const signed = key ? signAcceptanceRecord(...) : undefined`
    return {
      // ...all existing fields unchanged...
      recordSignature: signed?.signature ?? null,
      signingKeyId: signed?.signingKeyId ?? null,
      signatureCanonicalVersion: signed ? CANONICAL_VERSION : null,
      documentSnapshot: {
        version: doc.version, locale: doc.locale, title: doc.title, body: doc.body,
        acceptanceLabel: doc.acceptanceLabel, contentHash: doc.contentHash,
      },
    }
  }
```

- [ ] **Step 4: Run it; confirm it passes.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent.test.ts`
Expected: PASS (all consent service tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/services/consent.ts packages/api/src/services/consent.test.ts
git commit -m "feat(#877): snapshot disclosed text + canonical version on accept"
```

---

### Task 4: Repo plumbing (in-memory spread + Drizzle mapper)

**Files:**
- Modify: `packages/api/src/repositories/drizzle/consent.ts` (`toAcceptance`, ~32-52)
- Test: `packages/api/src/repositories/drizzle/consent.test.ts` (real-pg parity; existing file)

The in-memory repo's `createAcceptance` already does `{ ...data }`, so the new fields flow through once the type carries them — no code change there. The Drizzle `.values({ ...data, id })` insert likewise carries them; only the read mapper `toAcceptance` must surface them.

- [ ] **Step 1: Write the failing parity test.** In the Drizzle consent test (runs under real pg):

```typescript
it('round-trips documentSnapshot + signatureCanonicalVersion', async () => {
  const snapshot = { version: 'v1', locale: 'en', title: 'T', body: 'B', acceptanceLabel: 'L',
                     contentHash: 'h' }
  const created = await repo.createAcceptance({ ...baseAcceptance, // existing fixture in this file
    signatureCanonicalVersion: 'v1', documentSnapshot: snapshot })
  const read = await repo.findUserDocumentAcceptance(created.userId, created.documentId)
  expect(read?.documentSnapshot).toEqual(snapshot)
  expect(read?.signatureCanonicalVersion).toBe('v1')
})
```

- [ ] **Step 2: Run it; confirm it fails.**

Run: `bunx vitest run packages/api/src/repositories/drizzle/consent.test.ts -t documentSnapshot` (requires a real pg `DATABASE_URL`; see CLAUDE.md docker recipe)
Expected: FAIL (`documentSnapshot` undefined on read — `toAcceptance` drops it).

- [ ] **Step 3: Implement.** In `drizzle/consent.ts` `toAcceptance`, add before `createdAt`:

```typescript
    signatureCanonicalVersion: r.signatureCanonicalVersion,
    documentSnapshot: r.documentSnapshot,
```

- [ ] **Step 4: Run it; confirm it passes.**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/repositories/drizzle/consent.ts packages/api/src/repositories/drizzle/consent.test.ts
git commit -m "feat(#877): persist + read snapshot fields in Drizzle consent repo"
```

---

### Task 5: Repo read methods for export

**Files:**
- Modify: `packages/api/src/repositories/types-consent.ts` (interface)
- Modify: `packages/api/src/repositories/in-memory/consent.ts`
- Modify: `packages/api/src/repositories/drizzle/consent.ts`
- Test: `packages/api/src/repositories/in-memory/consent.test.ts`

- [ ] **Step 1: Add to the interface.** In `types-consent.ts` `ConsentRepository`:

```typescript
  findAcceptanceById(id: string): Promise<ConsentAcceptance | undefined>
  findAcceptancesByUser(userId: string): Promise<ConsentAcceptance[]>
  findAcceptancesByBooking(bookingId: string): Promise<ConsentAcceptance[]>
```

- [ ] **Step 2: Write the failing in-memory test.**

```typescript
it('finds acceptances by id, user, and booking', async () => {
  const a = await repo.createAcceptance({ ...validUserAcceptance }) // existing fixture
  expect((await repo.findAcceptanceById(a.id))?.id).toBe(a.id)
  expect(await repo.findAcceptancesByUser(a.userId)).toHaveLength(1)
  expect(await repo.findAcceptancesByBooking('booking_none')).toEqual([])
})
```

- [ ] **Step 3: Run it; confirm it fails.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/repositories/in-memory/consent.test.ts -t "by id, user"`
Expected: FAIL (method not a function).

- [ ] **Step 4: Implement both repos.** In-memory (`in-memory/consent.ts`):

```typescript
  async findAcceptanceById(id: string) { return this.acceptances.find((a) => a.id === id) }
  async findAcceptancesByUser(userId: string) { return this.acceptances.filter((a) => a.userId === userId) }
  async findAcceptancesByBooking(bookingId: string) { return this.acceptances.filter((a) => a.bookingId === bookingId) }
```

Drizzle (`drizzle/consent.ts`, mirroring existing query methods + `toAcceptance`):

```typescript
  async findAcceptanceById(id: string) {
    const [row] = await this.db.select().from(consentAcceptances).where(eq(consentAcceptances.id, id)).limit(1)
    return row ? toAcceptance(row) : undefined
  }
  async findAcceptancesByUser(userId: string) {
    const rows = await this.db.select().from(consentAcceptances).where(eq(consentAcceptances.userId, userId))
    return rows.map(toAcceptance)
  }
  async findAcceptancesByBooking(bookingId: string) {
    const rows = await this.db.select().from(consentAcceptances).where(eq(consentAcceptances.bookingId, bookingId))
    return rows.map(toAcceptance)
  }
```

- [ ] **Step 5: Run it; confirm it passes + typecheck.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/repositories/in-memory/consent.test.ts && bun run --filter @kuruma/api typecheck`
Expected: PASS; typecheck clean (the `repositories.test.ts` exhaustiveness map may need the new methods — add them if it fails).

- [ ] **Step 6: Commit.**

```bash
git add packages/api/src/repositories/
git commit -m "feat(#877): consent repo read methods for evidence export"
```

---

### Task 6: Pure verification (gate chain)

**Files:**
- Create: `packages/api/src/services/consent-evidence-verify.ts`
- Test: `packages/api/src/services/consent-evidence-verify.test.ts`

- [ ] **Step 1: Write the failing tests (one behavior per `it`).**

```typescript
import { describe, expect, it } from 'vitest'
import { verifyAcceptance } from './consent-evidence-verify'
import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import { signAcceptanceRecord } from './consent-signing'

const KEY = { key: 'secret', keyId: 'v1' }
function signedAcceptance(over = {}) { /* build a ConsentAcceptance with a valid snapshot + signature */
  const snap = { version: 'v1', locale: 'en', title: 'T', body: 'B', acceptanceLabel: 'L',
                 contentHash: computeContentHash({ title: 'T', body: 'B', acceptanceLabel: 'L' }) }
  const base = { id: 'acc_1', documentId: 'doc_1', consentType: 'RENTER_TOS', userId: 'u1',
    operatorId: null, operatorMembershipId: null, actorRole: 'RENTER', bookingId: null,
    acceptedAt: new Date('2026-06-24T00:00:00Z'), context: null, ipAddress: null, userAgent: null,
    method: 'CLICKWRAP', signatureRef: null, createdAt: new Date(), signatureCanonicalVersion: 'v1',
    documentSnapshot: snap } as const
  const sig = signAcceptanceRecord({ documentId: base.documentId, contentHash: snap.contentHash,
    consentType: base.consentType, version: snap.version, locale: snap.locale, userId: base.userId,
    operatorId: base.operatorId, operatorMembershipId: base.operatorMembershipId,
    bookingId: base.bookingId, method: base.method, acceptedAt: base.acceptedAt,
    ipAddress: base.ipAddress, userAgent: base.userAgent }, KEY)
  return { ...base, recordSignature: sig.signature, signingKeyId: sig.signingKeyId, ...over }
}

it('VERIFIED when snapshot hashes correctly and signature matches', () => {
  expect(verifyAcceptance(signedAcceptance(), () => KEY).status).toBe('VERIFIED')
})
it('SNAPSHOT_MISSING when no snapshot', () => {
  expect(verifyAcceptance(signedAcceptance({ documentSnapshot: null }), () => KEY).status).toBe('SNAPSHOT_MISSING')
})
it('SNAPSHOT_HASH_MISMATCH when body altered but hash left intact (the attack)', () => {
  const a = signedAcceptance()
  const tampered = { ...a, documentSnapshot: { ...a.documentSnapshot!, body: 'EVIL' } }
  expect(verifyAcceptance(tampered, () => KEY).status).toBe('SNAPSHOT_HASH_MISMATCH')
})
it('UNSIGNED when recordSignature null', () => {
  expect(verifyAcceptance(signedAcceptance({ recordSignature: null }), () => KEY).status).toBe('UNSIGNED')
})
it('KEY_UNAVAILABLE when signingKeyId is not resolvable', () => {
  // resolver must DISCRIMINATE on keyId, else 'v9' would resolve to a key and the gate is skipped.
  const onlyV1 = (keyId: string) => (keyId === 'v1' ? KEY : undefined)
  expect(verifyAcceptance(signedAcceptance({ signingKeyId: 'v9' }), onlyV1).status).toBe('KEY_UNAVAILABLE')
})
it('SIGNATURE_MISMATCH when the signature was altered', () => {
  expect(verifyAcceptance(signedAcceptance({ recordSignature: 'deadbeef' }), () => KEY).status).toBe('SIGNATURE_MISMATCH')
})
```

- [ ] **Step 2: Run; confirm fail.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent-evidence-verify.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure function.**

```typescript
import { type DocumentSnapshot, computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentAcceptance } from '../stores'
import { type SigningKey, signAcceptanceRecord } from './consent-signing'

export type ConsentVerificationStatus =
  | 'VERIFIED' | 'SNAPSHOT_MISSING' | 'SNAPSHOT_HASH_MISMATCH'
  | 'UNSIGNED' | 'KEY_UNAVAILABLE' | 'SIGNATURE_MISMATCH'

export interface ConsentVerification { status: ConsentVerificationStatus; detail?: string }

/** Gate chain (spec §Verification): first failing gate is the status. `getKey` resolves a
 *  keyId to its SigningKey (undefined when we no longer hold it). Pure — no I/O. */
export function verifyAcceptance(
  a: ConsentAcceptance,
  getKey: (keyId: string) => SigningKey | undefined,
): ConsentVerification {
  const snap: DocumentSnapshot | null = a.documentSnapshot
  if (!snap) return { status: 'SNAPSHOT_MISSING' }
  if (computeContentHash(snap) !== snap.contentHash) return { status: 'SNAPSHOT_HASH_MISMATCH' }
  if (!a.recordSignature) return { status: 'UNSIGNED' }
  const key = a.signingKeyId ? getKey(a.signingKeyId) : undefined
  if (!key) return { status: 'KEY_UNAVAILABLE', detail: a.signingKeyId ?? undefined }
  const recomputed = signAcceptanceRecord({
    documentId: a.documentId, contentHash: snap.contentHash, consentType: a.consentType,
    version: snap.version, locale: snap.locale, userId: a.userId, operatorId: a.operatorId,
    operatorMembershipId: a.operatorMembershipId, bookingId: a.bookingId, method: a.method,
    acceptedAt: a.acceptedAt, ipAddress: a.ipAddress, userAgent: a.userAgent,
  }, key).signature
  return recomputed === a.recordSignature ? { status: 'VERIFIED' } : { status: 'SIGNATURE_MISMATCH' }
}
```

Note: `computeContentHash(snap)` works because `DocumentSnapshot extends DisclosureArtifact`.
Note: this verifies under the current canonical version only; rows whose `signatureCanonicalVersion` differs from the live `CANONICAL_VERSION` are a future concern tracked with #1050 — leave a `// TODO(#1050)` above the `signAcceptanceRecord` recompute.

- [ ] **Step 4: Run; confirm pass.**

Run: same as Step 2. Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/services/consent-evidence-verify.ts packages/api/src/services/consent-evidence-verify.test.ts
git commit -m "feat(#877): pure consent verification gate chain"
```

---

### Task 7: `ConsentEvidenceService` + DI

**Files:**
- Create: `packages/api/src/services/consent-evidence.ts`
- Modify: `packages/api/src/index.ts` (construct + wire)
- Test: `packages/api/src/services/consent-evidence.test.ts`

- [ ] **Step 1: Write the failing test.**

```typescript
it('assembles an evidence bundle with verification for an acceptance id', async () => {
  const repo = new InMemoryConsentRepository() // existing double
  const acc = await repo.createAcceptance({ /* a fully-signed fixture, snapshot present */ })
  const svc = new ConsentEvidenceService(repo, (keyId) => keyId === 'v1' ? { key: 'secret', keyId } : undefined)
  const ev = await svc.getConsentEvidence(acc.id)
  expect(ev?.acceptance.id).toBe(acc.id)
  expect(ev?.document).toEqual(acc.documentSnapshot)
  expect(ev?.verification.status).toBe('VERIFIED')
})
it('returns undefined for an unknown acceptance id', async () => {
  const svc = new ConsentEvidenceService(new InMemoryConsentRepository(), () => undefined)
  expect(await svc.getConsentEvidence('nope')).toBeUndefined()
})
```

- [ ] **Step 2: Run; confirm fail.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent-evidence.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```typescript
import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentRepository } from '../repositories/types-consent'
import type { ConsentAcceptance } from '../stores'
import type { SigningKey } from './consent-signing'
import { type ConsentVerification, verifyAcceptance } from './consent-evidence-verify'

export interface ConsentEvidence {
  acceptance: Pick<ConsentAcceptance,
    'id' | 'userId' | 'actorRole' | 'documentId' | 'consentType' | 'operatorId'
    | 'operatorMembershipId' | 'bookingId' | 'acceptedAt' | 'method' | 'ipAddress' | 'userAgent'>
  document: DocumentSnapshot | null
  signature: { recordSignature: string | null; signingKeyId: string | null; signatureCanonicalVersion: string | null }
  verification: ConsentVerification
}

export class ConsentEvidenceService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly getKey: (keyId: string) => SigningKey | undefined,
  ) {}

  private toEvidence(a: ConsentAcceptance): ConsentEvidence {
    return {
      acceptance: { id: a.id, userId: a.userId, actorRole: a.actorRole, documentId: a.documentId,
        consentType: a.consentType, operatorId: a.operatorId, operatorMembershipId: a.operatorMembershipId,
        bookingId: a.bookingId, acceptedAt: a.acceptedAt, method: a.method, ipAddress: a.ipAddress,
        userAgent: a.userAgent },
      document: a.documentSnapshot,
      signature: { recordSignature: a.recordSignature, signingKeyId: a.signingKeyId,
        signatureCanonicalVersion: a.signatureCanonicalVersion },
      verification: verifyAcceptance(a, this.getKey),
    }
  }

  async getConsentEvidence(acceptanceId: string): Promise<ConsentEvidence | undefined> {
    const a = await this.repo.findAcceptanceById(acceptanceId)
    return a ? this.toEvidence(a) : undefined
  }
  async getConsentEvidenceForUser(userId: string): Promise<ConsentEvidence[]> {
    return (await this.repo.findAcceptancesByUser(userId)).map((a) => this.toEvidence(a))
  }
  async getConsentEvidenceForBooking(bookingId: string): Promise<ConsentEvidence[]> {
    return (await this.repo.findAcceptancesByBooking(bookingId)).map((a) => this.toEvidence(a))
  }
}
```

The `getKey` resolver: today only the current key exists, so wire `(keyId) => { const k = resolveSigningKey(); return k && k.keyId === keyId ? k : undefined }`. (When #1050 lands a registry, swap this lambda.)

- [ ] **Step 4: Wire DI in `index.ts`.** Near the existing `new ConsentService(...)`/`ConsentGateService` construction, add:

```typescript
import { ConsentEvidenceService } from './services/consent-evidence'
import { resolveSigningKey } from './services/consent-signing'
// ...
const consentEvidenceService = new ConsentEvidenceService(consentRepo, (keyId) => {
  const k = resolveSigningKey()
  return k && k.keyId === keyId ? k : undefined
})
```

Pass `consentEvidenceService` into the admin routes factory (Task 8).

- [ ] **Step 5: Run + typecheck.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent-evidence.test.ts && bun run --filter @kuruma/api typecheck`
Expected: PASS; clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/api/src/services/consent-evidence.ts packages/api/src/services/consent-evidence.test.ts packages/api/src/index.ts
git commit -m "feat(#877): ConsentEvidenceService assembles verified bundles"
```

---

### Task 8: Platform-admin export route

**Files:**
- Modify: `packages/api/src/routes/admin.ts` (add the route under `requirePlatformAdmin`)
- Test: `packages/api/src/routes/admin.test.ts` (or the existing admin route test file)

- [ ] **Step 1: Write the failing test.** Mirror the existing admin-route tests (they build the app with a `PLATFORM_ADMIN` session and assert 403 for other roles):

```typescript
it('GET /admin/consent/acceptances/:id/evidence returns the bundle for an admin', async () => {
  const res = await adminApp.request(`/admin/consent/acceptances/${seededAcceptanceId}/evidence`)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data.acceptance.id).toBe(seededAcceptanceId)
  expect(body.data.verification.status).toBeDefined()
})
it('rejects a renter caller with 403', async () => {
  const res = await renterApp.request(`/admin/consent/acceptances/x/evidence`)
  expect(res.status).toBe(403)
})
it('returns 404 for an unknown acceptance', async () => {
  const res = await adminApp.request(`/admin/consent/acceptances/nope/evidence`)
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run; confirm fail.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/routes/admin.test.ts -t evidence`
Expected: FAIL (404 route / handler missing).

- [ ] **Step 3: Implement.** In `admin.ts`, the admin sub-app already does `app.use('/admin/*', requirePlatformAdmin)`. Take `ConsentEvidenceService` into the factory and add:

```typescript
  app.get('/admin/consent/acceptances/:id/evidence', async (c) => {
    const evidence = await consentEvidenceService.getConsentEvidence(c.req.param('id'))
    if (!evidence) return fail(c, 404, 'ACCEPTANCE_NOT_FOUND')
    return ok(c, evidence)
  })
```

Use the existing `ok`/`fail` from `routes/helpers.ts` (already imported in this file or import them). Thread `consentEvidenceService` from `index.ts` into this factory's params.

- [ ] **Step 4: Run; confirm pass.**

Run: same as Step 2. Expected: PASS (admin 200, renter 403, unknown 404).

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/routes/admin.ts packages/api/src/routes/admin.test.ts packages/api/src/index.ts
git commit -m "feat(#877): platform-admin consent evidence export route"
```

---

### Task 9: CLI export

**Files:**
- Create: `scripts/consent-evidence.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Implement the CLI** (mirrors the env/db wiring of `scripts/backfill-vehicle-expiry.ts`):

```typescript
// Usage: bun run consent:evidence -- <acceptanceId> | --user <id> | --booking <id>
import { getDb } from '@kuruma/shared/db'
import { DrizzleConsentRepository } from '../packages/api/src/repositories/drizzle/consent'
import { ConsentEvidenceService } from '../packages/api/src/services/consent-evidence'
import { resolveSigningKey } from '../packages/api/src/services/consent-signing'

async function main() {
  const [a, b] = process.argv.slice(2)
  const repo = new DrizzleConsentRepository(getDb())
  const svc = new ConsentEvidenceService(repo, (keyId) => {
    const k = resolveSigningKey(); return k && k.keyId === keyId ? k : undefined
  })
  const out = a === '--user' ? await svc.getConsentEvidenceForUser(b)
    : a === '--booking' ? await svc.getConsentEvidenceForBooking(b)
    : await svc.getConsentEvidence(a)
  if (!out) { console.error('not found'); process.exit(1) }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

(If importing `packages/api/...` from `scripts/` trips a boundary lint, place the script under `packages/api/scripts/` and add the run-script there instead — follow whatever the existing `db:backfill-*` scripts do.)

- [ ] **Step 2: Add the script.** In `package.json` `scripts`: `"consent:evidence": "bun run scripts/consent-evidence.ts"`.

- [ ] **Step 3: Smoke-test against a seeded local DB.**

Run: `DATABASE_URL=<local> bun run consent:evidence -- <a seeded acceptance id>`
Expected: a JSON bundle with a `verification.status`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/consent-evidence.ts package.json
git commit -m "feat(#877): CLI consent evidence export"
```

---

### Task 10: Guarded backfill of legacy snapshots

**Files:**
- Create: `scripts/backfill-consent-snapshot.ts`
- Modify: `package.json` (scripts)
- Test: `packages/api/src/services/consent-backfill.test.ts` (unit-test the pure decision; the script is a thin shell)

- [ ] **Step 1: Write the failing test for the pure decision function.**

```typescript
import { decideBackfill } from '../../../scripts/consent-backfill-decide' // pure helper (Step 3)
import { computeContentHash, CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'
import { signAcceptanceRecord } from '../services/consent-signing'

const KEY = { key: 'secret', keyId: 'v1' }
// helper builds an unsigned-snapshot acceptance + its current doc + a valid signature over that doc
it('backfills when current doc is self-consistent AND HMAC matches', () => {
  const r = decideBackfill(/* acceptance, currentDoc, getKey */)
  expect(r.action).toBe('backfill')
})
it('skips current-doc-hash-mismatch when doc text and its own hash disagree', () => {
  expect(decideBackfill(/* doc with body!=hash */).action).toBe('skipped-current-doc-hash-mismatch')
})
it('skips hash-mismatch when the doc drifted from what was signed', () => {
  expect(decideBackfill(/* doc whose hash != signed hash */).action).toBe('skipped-hash-mismatch')
})
it('skips unsigned rows', () => {
  expect(decideBackfill(/* recordSignature null */).action).toBe('skipped-unsigned')
})
it('backfills with timestamp-drift noted when updatedAt>acceptedAt but HMAC matches', () => {
  const r = decideBackfill(/* updatedAt later, content identical */)
  expect(r.action).toBe('backfill'); expect(r.timestampDrift).toBe(true)
})
```

- [ ] **Step 2: Run; confirm fail.**

Run: `env -u DATABASE_URL bunx vitest run packages/api/src/services/consent-backfill.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure decision** (`scripts/consent-backfill-decide.ts`), then the thin script shell:

```typescript
import { type DocumentSnapshot, computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import type { ConsentAcceptance, ConsentDocument } from '../packages/api/src/stores'
import { type SigningKey, signAcceptanceRecord } from '../packages/api/src/services/consent-signing'

export type BackfillAction =
  | 'backfill' | 'skipped-current-doc-hash-mismatch' | 'skipped-hash-mismatch' | 'skipped-unsigned'

export interface BackfillDecision { action: BackfillAction; snapshot?: DocumentSnapshot; timestampDrift?: boolean }

export function decideBackfill(
  a: ConsentAcceptance, doc: ConsentDocument, getKey: (keyId: string) => SigningKey | undefined,
): BackfillDecision {
  // Gate 1: source-doc self-consistency (text -> its own hash) — must precede the HMAC gate.
  if (computeContentHash(doc) !== doc.contentHash) return { action: 'skipped-current-doc-hash-mismatch' }
  // Gate 3: no crypto proof for unsigned rows.
  if (!a.recordSignature) return { action: 'skipped-unsigned' }
  const key = a.signingKeyId ? getKey(a.signingKeyId) : undefined
  if (!key) return { action: 'skipped-unsigned' } // can't prove without the key; treat as unprovable
  // Gate 2: does the CURRENT doc's hash, signed under this row's fields, reproduce recordSignature?
  const recomputed = signAcceptanceRecord({
    documentId: a.documentId, contentHash: doc.contentHash, consentType: a.consentType,
    version: doc.version, locale: doc.locale, userId: a.userId, operatorId: a.operatorId,
    operatorMembershipId: a.operatorMembershipId, bookingId: a.bookingId, method: a.method,
    acceptedAt: a.acceptedAt, ipAddress: a.ipAddress, userAgent: a.userAgent,
  }, key).signature
  if (recomputed !== a.recordSignature) return { action: 'skipped-hash-mismatch' }
  const snapshot: DocumentSnapshot = { version: doc.version, locale: doc.locale, title: doc.title,
    body: doc.body, acceptanceLabel: doc.acceptanceLabel, contentHash: doc.contentHash }
  return { action: 'backfill', snapshot, timestampDrift: doc.updatedAt > a.acceptedAt }
}
```

The script (`scripts/backfill-consent-snapshot.ts`): load all acceptances with `documentSnapshot IS NULL`, join the current doc, call `decideBackfill`; for `backfill` write `{ documentSnapshot, signatureCanonicalVersion: a.signingKeyId ? CANONICAL_VERSION : null }`; tally `{ backfilled, timestampDrift, 'skipped-*' }`; print the report and exit non-zero if any `skipped-*` rows exist so a human reviews them.

- [ ] **Step 4: Run; confirm pass.**

Run: same as Step 2. Expected: PASS (5 decisions).

- [ ] **Step 5: Add the script + commit.** `package.json`: `"db:backfill-consent-snapshot": "bun run scripts/backfill-consent-snapshot.ts"`.

```bash
git add scripts/consent-backfill-decide.ts scripts/backfill-consent-snapshot.ts packages/api/src/services/consent-backfill.test.ts package.json
git commit -m "feat(#877): guarded backfill of legacy consent snapshots"
```

---

### Task 11: Full-suite gate + docs

- [ ] **Step 1: Run the full gates.**

Run: `bun run --filter @kuruma/api typecheck && env -u DATABASE_URL bun run --filter @kuruma/api test && bun run --filter @kuruma/api lint:boundaries && bun run db:verify`
Expected: all green. (Drizzle parity tests in Task 4 run under the real-pg CI lane; verify locally with a docker pg per CLAUDE.md before pushing.)

- [ ] **Step 2: Update the runbook reference.** Add a short "Producing a consent evidence export" section to `docs/runbooks/2026-06-24-consent-signing-key.md` pointing at `consent:evidence` and the admin route.

- [ ] **Step 3: Commit + open PR.**

```bash
git add docs/
git commit -m "docs(#877): consent evidence export runbook note"
# rebase onto origin/develop, push, open PR base develop, body: Refs #877; tie #1049/#1050.
```

---

## Notes for the executor

- **Test fixtures already exist** in `consent.test.ts`, `in-memory/consent.test.ts`, `drizzle/consent.test.ts` — reuse their helpers (`publishDoc`, `makeService`, base acceptance fixtures) rather than re-inventing. Read each test file's top before writing new cases.
- **`signAcceptanceRecord` is the single source of the signed field set.** If you change which fields it covers, the verify recompute (Task 6) and backfill recompute (Task 10) must change identically — they intentionally mirror it.
- **Architecture boundaries:** routes→services→repositories only. The route (Task 8) must not import a repo; it takes `ConsentEvidenceService`. `index.ts` is the only place concrete repos/services are constructed.
- **#1050 hook:** the `getKey` resolver lambda is the single seam to swap for a multi-key registry; verification already dispatches on `signingKeyId`.
