// CLI: bun run db:backfill-consent-snapshot [--dry-run]
// Backfills documentSnapshot onto consent_acceptances rows that have none.
// Safe to re-run (idempotent): only rows with documentSnapshot IS NULL are touched.
// Exits non-zero if any rows were skipped due to decision-level checks.
import { eq, isNull } from 'drizzle-orm'
import { resolveSigningKey } from '../packages/api/src/services/consent-signing'
import { getDb } from '../packages/shared/src/db'
import { consentAcceptances, consentDocuments } from '../packages/shared/src/db/schema'
import { CANONICAL_VERSION } from '../packages/shared/src/lib/consent-canonical'
import { decideBackfill } from './consent-backfill-decide'

const dryRun = process.argv.includes('--dry-run')

async function main() {
  // Pin the OWNER url explicitly (not the DATABASE_URL_RUNTIME the app prefers):
  // this is a break-glass correction tool that UPDATEs consent_acceptances (:96),
  // which the reduced-privilege runtime role is forbidden to do (#1553 append-only
  // seal). Owner-only, so resolve DATABASE_URL directly.
  const db = getDb(process.env.DATABASE_URL)
  const signingKey = resolveSigningKey()
  const getKey = (keyId: string) =>
    signingKey && signingKey.keyId === keyId ? signingKey : undefined

  // Load all acceptances with no snapshot yet.
  const rows = await db
    .select()
    .from(consentAcceptances)
    .where(isNull(consentAcceptances.documentSnapshot))

  console.log(`Found ${rows.length} acceptance(s) with no documentSnapshot.`)

  const counts: Record<string, number> = {
    backfill: 0,
    'skipped-current-doc-hash-mismatch': 0,
    'skipped-hash-mismatch': 0,
    'skipped-unsigned': 0,
    'skipped-doc-not-found': 0,
    timestampDrift: 0,
  }

  for (const row of rows) {
    // Load the current document for this acceptance.
    const [docRow] = await db
      .select()
      .from(consentDocuments)
      .where(eq(consentDocuments.id, row.documentId))
      .limit(1)

    if (!docRow) {
      counts['skipped-doc-not-found']++
      console.warn(`[SKIP-NO-DOC] acceptance=${row.id} documentId=${row.documentId}`)
      continue
    }

    const doc = {
      id: docRow.id,
      type: docRow.type,
      version: docRow.version,
      locale: docRow.locale,
      title: docRow.title,
      body: docRow.body,
      acceptanceLabel: docRow.acceptanceLabel,
      contentHash: docRow.contentHash,
      status: docRow.status,
      effectiveFrom: docRow.effectiveFrom,
      publishedAt: docRow.publishedAt,
      createdAt: docRow.createdAt,
      updatedAt: docRow.updatedAt,
    }

    const acceptance = {
      id: row.id,
      documentId: row.documentId,
      consentType: row.consentType,
      userId: row.userId,
      operatorId: row.operatorId,
      operatorMembershipId: row.operatorMembershipId,
      actorRole: row.actorRole,
      bookingId: row.bookingId,
      acceptedAt: row.acceptedAt,
      context: row.context,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      method: row.method,
      recordSignature: row.recordSignature,
      signingKeyId: row.signingKeyId,
      signatureCanonicalVersion: row.signatureCanonicalVersion,
      documentSnapshot: row.documentSnapshot,
      signatureRef: row.signatureRef,
      createdAt: row.createdAt,
    }

    const decision = decideBackfill(acceptance, doc, getKey)
    counts[decision.action]++

    if (decision.action === 'backfill') {
      if (decision.timestampDrift) counts.timestampDrift++
      if (!dryRun) {
        await db
          .update(consentAcceptances)
          .set({
            documentSnapshot: decision.snapshot,
            signatureCanonicalVersion: row.signingKeyId ? CANONICAL_VERSION : null,
          })
          .where(eq(consentAcceptances.id, row.id))
      }
    } else {
      console.warn(`[${decision.action.toUpperCase()}] acceptance=${row.id}`)
    }
  }

  const skippedCount =
    counts['skipped-current-doc-hash-mismatch'] +
    counts['skipped-hash-mismatch'] +
    counts['skipped-unsigned'] +
    counts['skipped-doc-not-found']

  const report = {
    dryRun,
    total: rows.length,
    backfilled: counts.backfill,
    timestampDrift: counts.timestampDrift,
    skippedUnsigned: counts['skipped-unsigned'],
    skippedHashMismatch: counts['skipped-hash-mismatch'],
    skippedCurrentDocHashMismatch: counts['skipped-current-doc-hash-mismatch'],
    skippedDocNotFound: counts['skipped-doc-not-found'],
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(skippedCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Consent-snapshot backfill failed:', e)
  process.exit(1)
})
