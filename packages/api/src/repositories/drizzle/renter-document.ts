import { renterDocuments } from '@kuruma/shared/db/schema'
import { type SQL, and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { type CallerContext, ForbiddenError, STAFF_ROLES } from '../../middleware/auth'
import type { RenterDocument } from '../../stores'
import type {
  CreateRenterDocumentData,
  DocumentVerifyInput,
  PaginatedResult,
  RenterDocumentFilters,
  RenterDocumentRepository,
} from '../types'
import type { Db } from './shared'

type Row = typeof renterDocuments.$inferSelect

function toRenterDocument(r: Row): RenterDocument {
  return {
    id: r.id,
    renterId: r.renterId,
    type: r.type,
    storageKey: r.storageKey,
    status: r.status,
    expiryDate: r.expiryDate,
    verifiedAt: r.verifiedAt,
    verifierId: r.verifierId,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

// Document verification is a PLATFORM identity check — only platform staff may
// review or read across renters. Operators are excluded (no cross-tenant scan
// access). Mirrors the in-memory double; defence in depth behind the route gate.
function isPlatformStaff(ctx: CallerContext): boolean {
  return STAFF_ROLES.has(ctx.role)
}

function requireVerifier(ctx: CallerContext): void {
  if (!isPlatformStaff(ctx)) {
    throw new ForbiddenError('document verification requires platform staff')
  }
}

export class DrizzleRenterDocumentRepository implements RenterDocumentRepository {
  constructor(private readonly db: Db) {}

  async create(ctx: CallerContext, data: CreateRenterDocumentData): Promise<RenterDocument> {
    if (!isPlatformStaff(ctx) && data.renterId !== ctx.userId) {
      throw new ForbiddenError('cannot upload a document for another renter')
    }
    const [inserted] = await this.db
      .insert(renterDocuments)
      .values({ renterId: data.renterId, type: data.type, storageKey: data.storageKey })
      .returning()
    if (!inserted) throw new Error('Failed to insert renter document')
    return toRenterDocument(inserted)
  }

  async findByRenter(ctx: CallerContext, renterId: string): Promise<RenterDocument[]> {
    if (!isPlatformStaff(ctx) && renterId !== ctx.userId) return []
    const rows = await this.db
      .select()
      .from(renterDocuments)
      .where(eq(renterDocuments.renterId, renterId))
      .orderBy(desc(renterDocuments.createdAt))
    return rows.map(toRenterDocument)
  }

  async findById(ctx: CallerContext, id: string): Promise<RenterDocument | undefined> {
    const [row] = await this.db.select().from(renterDocuments).where(eq(renterDocuments.id, id))
    if (!row) return undefined
    if (!isPlatformStaff(ctx) && row.renterId !== ctx.userId) return undefined
    return toRenterDocument(row)
  }

  async listPending(
    ctx: CallerContext,
    filters?: RenterDocumentFilters,
  ): Promise<PaginatedResult<RenterDocument>> {
    requireVerifier(ctx)
    const where = eq(renterDocuments.status, 'PENDING')
    const [countResult, rows] = await Promise.all([
      this.db.select({ value: count() }).from(renterDocuments).where(where),
      (() => {
        let q = this.db
          .select()
          .from(renterDocuments)
          .where(where)
          .orderBy(asc(renterDocuments.createdAt))
          .$dynamic()
        if (filters?.limit != null) q = q.limit(filters.limit)
        if (filters?.offset != null) q = q.offset(filters.offset)
        return q
      })(),
    ])
    return { data: rows.map(toRenterDocument), total: countResult[0]?.value ?? 0 }
  }

  async verify(
    ctx: CallerContext,
    id: string,
    verdict: DocumentVerifyInput,
  ): Promise<RenterDocument | undefined> {
    requireVerifier(ctx)
    const [updated] = await this.db
      .update(renterDocuments)
      .set({
        status: verdict.status,
        expiryDate: verdict.expiryDate ?? null,
        rejectionReason: verdict.rejectionReason ?? null,
        verifierId: verdict.verifierId,
        verifiedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(renterDocuments.id, id))
      .returning()
    return updated ? toRenterDocument(updated) : undefined
  }

  async findApprovedByType(
    renterId: string,
    type: RenterDocument['type'],
  ): Promise<RenterDocument[]> {
    const conditions: SQL[] = [
      eq(renterDocuments.renterId, renterId),
      eq(renterDocuments.type, type),
      eq(renterDocuments.status, 'APPROVED'),
    ]
    const rows = await this.db
      .select()
      .from(renterDocuments)
      .where(and(...conditions))
    return rows.map(toRenterDocument)
  }
}
