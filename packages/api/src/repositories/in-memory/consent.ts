import type { ConsentDocStatus, ConsentType } from '@kuruma/shared/enums'
import { PG_ERROR } from '../../pg-errors'
import type { ConsentAcceptance, ConsentDocument } from '../../stores'
import type {
  ConsentAcceptanceListRow,
  ConsentAcceptanceQuery,
  ConsentRepository,
  NewConsentAcceptance,
  NewConsentDocument,
} from '../types'
import { CONSENT_ACCEPTANCE_LIST_LIMIT } from '../types-consent'

// Mirror postgres-js's PostgresError shape (top-level `code` + `constraint_name`) so the
// service's 23505 catch-path behaves identically against the in-memory and Drizzle repos.
// Same pattern as repositories/in-memory/booking.ts.
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

export class InMemoryConsentRepository implements ConsentRepository {
  private readonly docs: Map<string, ConsentDocument>
  private readonly acceptances: ConsentAcceptance[] = []

  constructor(documents: ConsentDocument[] = []) {
    this.docs = new Map(documents.map((d) => [d.id, d]))
  }

  async findDocumentById(id: string): Promise<ConsentDocument | undefined> {
    return this.docs.get(id)
  }

  async findLatestPublishedVersion(type: ConsentType, now: Date): Promise<string | undefined> {
    const versions = [...this.docs.values()]
      .filter((d) => d.type === type && d.status === 'PUBLISHED' && d.effectiveFrom <= now)
      .map((d) => d.version)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return versions.at(-1)
  }

  async findPublishedDocument(
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined> {
    return [...this.docs.values()].find(
      (d) =>
        d.type === type && d.version === version && d.locale === locale && d.status === 'PUBLISHED',
    )
  }

  async hasAcceptedVersion(userId: string, type: ConsentType, version: string): Promise<boolean> {
    const ids = new Set(
      [...this.docs.values()]
        .filter((d) => d.type === type && d.version === version)
        .map((d) => d.id),
    )
    return this.acceptances.some((a) => a.userId === userId && ids.has(a.documentId))
  }

  async findUserDocumentAcceptance(
    userId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find(
      (a) =>
        a.userId === userId &&
        a.documentId === documentId &&
        a.bookingId === null &&
        a.operatorId === null,
    )
  }

  async findBookingAcceptance(bookingId: string): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find((a) => a.bookingId === bookingId)
  }

  async findOperatorDocumentAcceptance(
    operatorId: string,
    documentId: string,
  ): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find((a) => a.operatorId === operatorId && a.documentId === documentId)
  }

  async findAcceptanceById(id: string): Promise<ConsentAcceptance | undefined> {
    return this.acceptances.find((a) => a.id === id)
  }

  async findAcceptancesByUser(userId: string): Promise<ConsentAcceptance[]> {
    return this.acceptances.filter((a) => a.userId === userId)
  }

  async findAcceptancesByBooking(bookingId: string): Promise<ConsentAcceptance[]> {
    return this.acceptances.filter((a) => a.bookingId === bookingId)
  }

  // Mirrors the Drizzle inner join (documentId -> document): an acceptance whose
  // document is absent is dropped, never surfaced with an empty version.
  async findAcceptances(q: ConsentAcceptanceQuery): Promise<ConsentAcceptanceListRow[]> {
    return this.acceptances
      .flatMap((a) => {
        const version = this.docs.get(a.documentId)?.version
        return version === undefined ? [] : [{ a, version }]
      })
      .filter(
        ({ a, version }) =>
          (q.userId === undefined || a.userId === q.userId) &&
          (q.consentType === undefined || a.consentType === q.consentType) &&
          (q.version === undefined || version === q.version) &&
          (q.acceptedFrom === undefined || a.acceptedAt >= q.acceptedFrom) &&
          (q.acceptedTo === undefined || a.acceptedAt <= q.acceptedTo),
      )
      .map(({ a, version }) => ({
        id: a.id,
        userId: a.userId,
        consentType: a.consentType,
        version,
        operatorId: a.operatorId,
        bookingId: a.bookingId,
        acceptedAt: a.acceptedAt,
      }))
      .sort((x, y) => y.acceptedAt.getTime() - x.acceptedAt.getTime())
      .slice(0, CONSENT_ACCEPTANCE_LIST_LIMIT)
  }

  async createAcceptance(data: NewConsentAcceptance): Promise<ConsentAcceptance> {
    this.assertUnique(data)
    const row: ConsentAcceptance = {
      ...data,
      id: crypto.randomUUID(),
      signatureRef: null,
      createdAt: new Date(),
    }
    this.acceptances.push(row)
    return row
  }

  async findLatestPublishedVersionForOperator(
    operatorId: string,
    type: ConsentType,
    now: Date,
  ): Promise<string | undefined> {
    return [...this.docs.values()]
      .filter(
        (d) =>
          d.operatorId === operatorId &&
          d.type === type &&
          d.status === 'PUBLISHED' &&
          d.effectiveFrom <= now,
      )
      .map((d) => d.version)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .at(-1)
  }

  async findPublishedOperatorDocument(
    operatorId: string,
    type: ConsentType,
    version: string,
    locale: string,
  ): Promise<ConsentDocument | undefined> {
    return [...this.docs.values()].find(
      (d) =>
        d.operatorId === operatorId &&
        d.type === type &&
        d.version === version &&
        d.locale === locale &&
        d.status === 'PUBLISHED',
    )
  }

  async findOperatorDocuments(operatorId: string, type: ConsentType): Promise<ConsentDocument[]> {
    return [...this.docs.values()].filter((d) => d.operatorId === operatorId && d.type === type)
  }

  async createOperatorDocuments(rows: NewConsentDocument[]): Promise<ConsentDocument[]> {
    const created: ConsentDocument[] = rows.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    for (const d of created) this.docs.set(d.id, d)
    return created
  }

  async deleteOperatorDraftRows(
    operatorId: string,
    type: ConsentType,
    version: string,
  ): Promise<void> {
    for (const [id, d] of this.docs) {
      if (
        d.operatorId === operatorId &&
        d.type === type &&
        d.version === version &&
        d.status === 'DRAFT'
      ) {
        this.docs.delete(id)
      }
    }
  }

  async setOperatorVersionStatus(p: {
    operatorId: string
    type: ConsentType
    version: string
    from: ConsentDocStatus
    to: ConsentDocStatus
    publishedAt: Date | null
    now: Date
  }): Promise<ConsentDocument[]> {
    const updated: ConsentDocument[] = []
    for (const [id, d] of this.docs) {
      if (
        d.operatorId === p.operatorId &&
        d.type === p.type &&
        d.version === p.version &&
        d.status === p.from
      ) {
        const next: ConsentDocument = {
          ...d,
          status: p.to,
          updatedAt: p.now,
          publishedAt: p.publishedAt ?? d.publishedAt,
        }
        this.docs.set(id, next)
        updated.push(next)
      }
    }
    return updated
  }

  // Priority early-returns are correct ONLY because the DB CHECK constraints
  // consent_liability_booking_chk and consent_operator_agreement_chk make the three
  // partial-unique predicates mutually disjoint: bookingId≠null implies RENTER_LIABILITY,
  // operatorId≠null implies OPERATOR_AGREEMENT, and the two are mutually exclusive.
  // This in-memory double does NOT re-enforce those CHECKs — it assumes callers construct
  // shape-valid rows. The Task 9 ConsentService subject-shape pre-check is the enforcing guard.
  private assertUnique(d: NewConsentAcceptance): void {
    if (d.bookingId !== null) {
      if (this.acceptances.some((a) => a.bookingId === d.bookingId))
        throw uniqueViolation('consent_unique_booking_liability')
      return
    }
    if (d.operatorId !== null) {
      if (
        this.acceptances.some((a) => a.operatorId === d.operatorId && a.documentId === d.documentId)
      )
        throw uniqueViolation('consent_unique_operator_document')
      return
    }
    if (
      this.acceptances.some(
        (a) =>
          a.userId === d.userId &&
          a.documentId === d.documentId &&
          a.bookingId === null &&
          a.operatorId === null,
      )
    )
      throw uniqueViolation('consent_unique_user_document')
  }
}
