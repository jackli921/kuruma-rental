import { CONSENT_CARDINALITY, type ConsentMethod, type ConsentType } from '@kuruma/shared/enums'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { ConsentRepository, NewConsentAcceptance } from '../repositories/types'
import type { ConsentAcceptance, ConsentDocument } from '../stores'
import { type SigningKey, resolveSigningKey, signAcceptanceRecord } from './consent-signing'

/** Required once-per-subject document types by role (operator types arrive in Phase 3). */
const REQUIRED_TYPES: Record<string, ConsentType[]> = {
  RENTER: ['RENTER_TOS', 'PRIVACY_POLICY'],
}

/** Locale every published cohort is guaranteed to carry — the fallback when the
 *  caller's locale was never authored for a given (type, version) (#877 Q4). */
const FALLBACK_LOCALE = 'en'

/** A consent the subject still owes, paired with the document to present. */
export interface PendingConsent {
  type: ConsentType
  document: ConsentDocument
}

export interface RecordAcceptanceInput {
  documentId: string
  userId: string
  actorRole: string | null
  operatorId?: string | null
  operatorMembershipId?: string | null
  bookingId?: string | null
}

export interface RecordAcceptanceMeta {
  now: Date
  ipAddress?: string | null
  userAgent?: string | null
}

export type RecordAcceptanceResult =
  | { ok: true; acceptance: ConsentAcceptance }
  | { ok: false; status: number; error: string }

export class ConsentService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly getSigningKey: () => SigningKey | undefined = resolveSigningKey,
  ) {}

  async recordAcceptance(
    input: RecordAcceptanceInput,
    meta: RecordAcceptanceMeta,
  ): Promise<RecordAcceptanceResult> {
    const doc = await this.repo.findDocumentById(input.documentId)
    if (!doc) return { ok: false, status: 404, error: 'DOCUMENT_NOT_FOUND' }
    if (doc.status !== 'PUBLISHED' || doc.effectiveFrom > meta.now)
      return { ok: false, status: 409, error: 'DOCUMENT_NOT_ACCEPTABLE' }

    const bookingId = input.bookingId ?? null
    const operatorId = input.operatorId ?? null
    // Subject-shape pre-check (the DB CHECKs are the real seal; this returns a clean 400).
    const isLiability = doc.type === 'RENTER_LIABILITY'
    const isOperator = doc.type === 'OPERATOR_AGREEMENT'
    if (isLiability !== (bookingId !== null) || isOperator !== (operatorId !== null))
      return { ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' }

    const existing = await this.findExisting(doc.type, input.userId, doc.id, operatorId, bookingId)
    if (existing) return { ok: true, acceptance: existing }

    const data = this.buildRow(doc, input, meta, operatorId, bookingId)
    try {
      return { ok: true, acceptance: await this.repo.createAcceptance(data) }
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
        const row = await this.findExisting(doc.type, input.userId, doc.id, operatorId, bookingId)
        if (row) return { ok: true, acceptance: row }
      }
      throw err
    }
  }

  async getRequiredReconsents(userId: string, role: string, now: Date): Promise<ConsentType[]> {
    const required = REQUIRED_TYPES[role] ?? []
    const missing: ConsentType[] = []
    for (const type of required) {
      if (CONSENT_CARDINALITY[type] !== 'ONCE_PER_SUBJECT') continue
      const version = await this.repo.findLatestPublishedVersion(type, now)
      if (!version) continue // nothing published yet → cannot block
      if (!(await this.repo.hasAcceptedVersion(userId, type, version))) missing.push(type)
    }
    return missing
  }

  async isCurrent(userId: string, role: string, now: Date): Promise<boolean> {
    return (await this.getRequiredReconsents(userId, role, now)).length === 0
  }

  /**
   * Presentation view of {@link getRequiredReconsents}: for each type the subject
   * still owes, resolve the live document to show — the caller's locale, falling
   * back to `en`. Returns required-order, empty when the subject is current.
   */
  async getPendingConsents(
    userId: string,
    role: string,
    locale: string,
    now: Date,
  ): Promise<PendingConsent[]> {
    const missing = await this.getRequiredReconsents(userId, role, now)
    const pending: PendingConsent[] = []
    for (const type of missing) {
      const version = await this.repo.findLatestPublishedVersion(type, now)
      if (!version) continue // getRequiredReconsents already skips unpublished; stay defensive
      const document =
        (await this.repo.findPublishedDocument(type, version, locale)) ??
        (await this.repo.findPublishedDocument(type, version, FALLBACK_LOCALE))
      if (document) pending.push({ type, document })
    }
    return pending
  }

  private buildRow(
    doc: { id: string; type: ConsentType; version: string; locale: string; contentHash: string },
    input: RecordAcceptanceInput,
    meta: RecordAcceptanceMeta,
    operatorId: string | null,
    bookingId: string | null,
  ): NewConsentAcceptance {
    const acceptedAt = meta.now
    const ipAddress = meta.ipAddress ?? null
    const userAgent = meta.userAgent ?? null
    // Single source of truth: the signed payload and the persisted row must carry
    // the identical method, or the signature wouldn't cover what's stored.
    const method: ConsentMethod = 'CLICKWRAP'
    const key = this.getSigningKey()
    const signed = key
      ? signAcceptanceRecord(
          {
            documentId: doc.id,
            contentHash: doc.contentHash,
            consentType: doc.type,
            version: doc.version,
            locale: doc.locale,
            userId: input.userId,
            operatorId,
            operatorMembershipId: input.operatorMembershipId ?? null,
            bookingId,
            method,
            acceptedAt,
            ipAddress,
            userAgent,
          },
          key,
        )
      : undefined
    return {
      documentId: doc.id,
      consentType: doc.type,
      userId: input.userId,
      operatorId,
      operatorMembershipId: input.operatorMembershipId ?? null,
      actorRole: input.actorRole,
      bookingId,
      acceptedAt,
      context: null,
      ipAddress,
      userAgent,
      method,
      recordSignature: signed?.signature ?? null,
      signingKeyId: signed?.signingKeyId ?? null,
    }
  }

  private findExisting(
    _type: ConsentType,
    userId: string,
    documentId: string,
    operatorId: string | null,
    bookingId: string | null,
  ): Promise<ConsentAcceptance | undefined> {
    if (bookingId !== null) return this.repo.findBookingAcceptance(bookingId)
    if (operatorId !== null) return this.repo.findOperatorDocumentAcceptance(operatorId, documentId)
    return this.repo.findUserDocumentAcceptance(userId, documentId)
  }
}
