import type { ConsentType } from '@kuruma/shared/enums'
import { consentAcceptances, consentDocuments } from '@kuruma/shared/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
