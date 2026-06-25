import type { ConsentType } from '@kuruma/shared/enums'
import { PG_ERROR } from '../../pg-errors'
import type { ConsentAcceptance, ConsentDocument } from '../../stores'
import type { ConsentRepository, NewConsentAcceptance } from '../types'

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
