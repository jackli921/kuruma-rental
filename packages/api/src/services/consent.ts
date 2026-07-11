import type { UserRole } from '@kuruma/shared/auth/roles'
import { CONSENT_CARDINALITY, type ConsentMethod, type ConsentType } from '@kuruma/shared/enums'
import { CANONICAL_VERSION } from '@kuruma/shared/lib/consent-canonical'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { ConsentRepository, NewConsentAcceptance } from '../repositories/types'
import type { ConsentAcceptance, ConsentDocument } from '../stores'
import { type SigningKey, resolveSigningKey, signAcceptanceRecord } from './consent-signing'

/**
 * Required once-per-subject document types by role (operator types arrive in
 * Phase 3). The literal is `satisfies`-checked against `UserRole` so a typo'd or
 * unreal role key fails to COMPILE — without it a misspelled key would silently
 * mean "owes nothing", i.e. fail OPEN, the wrong default for a legal gate. The
 * `Record<string, …>` annotation keeps the runtime lookup keyable by a raw JWT
 * role string (mirrors the `roleSet` idiom in `@kuruma/shared/auth/roles`).
 */
const REQUIRED_TYPES: Record<string, ConsentType[]> = {
  RENTER: ['RENTER_TOS', 'PRIVACY_POLICY'],
} satisfies Partial<Record<UserRole, ConsentType[]>>

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

    // OPERATOR_RENTAL_TERMS is minted ONLY inside the booking transaction (sub-slice 4:
    // buildSignedAcceptance → consentRepo.createAcceptance), where the version is pinned and
    // signed against the exact booking. recordAcceptance is the self-serve accept path, so it
    // must refuse it outright — defense-in-depth against a future acceptSchema that carries a
    // bookingId (today the route can't, so the shape-check below would also 400, via null bookingId).
    if (doc.type === 'OPERATOR_RENTAL_TERMS')
      return { ok: false, status: 400, error: 'OPERATOR_TERMS_NOT_SELF_MINTABLE' }

    const bookingId = input.bookingId ?? null
    const operatorId = input.operatorId ?? null
    // Subject-shape pre-check (the DB CHECKs are the real seal; this returns a clean 400).
    // OPERATOR_RENTAL_TERMS (the other per-booking type) is refused above, so on this path only
    // RENTER_LIABILITY carries a bookingId; OPERATOR_AGREEMENT requires an operatorId and no bookingId.
    const requiresBooking = doc.type === 'RENTER_LIABILITY'
    const requiresOperator = doc.type === 'OPERATOR_AGREEMENT'
    if (requiresBooking !== (bookingId !== null) || requiresOperator !== (operatorId !== null))
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

  /**
   * The owed (type, version) pairs for a subject — the single per-type DB walk
   * that both {@link getRequiredReconsents} and {@link getPendingConsents} consume,
   * so a status render resolves each version once, not in two passes (#1036 M2).
   *
   * Fail-open by design: a required type with NO published version is skipped, so
   * the subject is treated as current until docs are published. This is the
   * intentional "inert until published" behaviour (prod runs migrations-only, no
   * seed). It is deliberately NOT instrumented per call — this runs on every
   * POST /bookings, so a log line each would be noise; the operational signal that
   * a required doc is unpublished belongs to the publish workflow, not this
   * hot-path gate (#1036 M3).
   */
  private async resolveMissing(
    userId: string,
    role: string,
    now: Date,
  ): Promise<{ type: ConsentType; version: string }[]> {
    const required = REQUIRED_TYPES[role] ?? []
    const missing: { type: ConsentType; version: string }[] = []
    for (const type of required) {
      if (CONSENT_CARDINALITY[type] !== 'ONCE_PER_SUBJECT') continue
      const version = await this.repo.findLatestPublishedVersion(type, now)
      if (!version) continue // nothing published yet → cannot block (fail-open, see above)
      if (!(await this.repo.hasAcceptedVersion(userId, type, version)))
        missing.push({ type, version })
    }
    return missing
  }

  async getRequiredReconsents(userId: string, role: string, now: Date): Promise<ConsentType[]> {
    return (await this.resolveMissing(userId, role, now)).map((m) => m.type)
  }

  async isCurrent(userId: string, role: string, now: Date): Promise<boolean> {
    return (await this.getRequiredReconsents(userId, role, now)).length === 0
  }

  /**
   * Presentation view of {@link getRequiredReconsents}: for each (type, version)
   * the subject still owes, resolve the live document to show — the caller's
   * locale, falling back to `en`. Returns required-order, empty when current.
   * Reuses {@link resolveMissing}'s versions, so it never re-queries them (#1036 M2).
   */
  async getPendingConsents(
    userId: string,
    role: string,
    locale: string,
    now: Date,
  ): Promise<PendingConsent[]> {
    const missing = await this.resolveMissing(userId, role, now)
    const pending: PendingConsent[] = []
    for (const { type, version } of missing) {
      const document =
        (await this.repo.findPublishedDocument(type, version, locale)) ??
        (await this.repo.findPublishedDocument(type, version, FALLBACK_LOCALE))
      if (document) pending.push({ type, document })
    }
    return pending
  }

  private buildRow(
    doc: {
      id: string
      type: ConsentType
      version: string
      locale: string
      contentHash: string
      title: string
      body: string
      acceptanceLabel: string
    },
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

  private findExisting(
    type: ConsentType,
    userId: string,
    documentId: string,
    operatorId: string | null,
    bookingId: string | null,
  ): Promise<ConsentAcceptance | undefined> {
    // Per-booking idempotency is now type-scoped (§6 H3): a booking may carry both a
    // liability and an operator-terms acceptance, so look up by (bookingId, type).
    if (bookingId !== null) return this.repo.findBookingAcceptance(bookingId, type)
    if (operatorId !== null) return this.repo.findOperatorDocumentAcceptance(operatorId, documentId)
    return this.repo.findUserDocumentAcceptance(userId, documentId)
  }
}
