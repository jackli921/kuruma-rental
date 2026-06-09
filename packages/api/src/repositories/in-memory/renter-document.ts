import { type CallerContext, ForbiddenError, STAFF_ROLES } from '../../middleware/auth'
import type { RenterDocument } from '../../stores'
import type {
  CreateRenterDocumentData,
  DocumentVerifyInput,
  PaginatedResult,
  RenterDocumentFilters,
  RenterDocumentRepository,
} from '../types'

// Document verification is a PLATFORM identity check — only platform staff may
// review or read across renters. Operators are deliberately excluded: they must
// never see another tenant's renter's ID scan.
function isPlatformStaff(ctx: CallerContext): boolean {
  return STAFF_ROLES.has(ctx.role)
}

function requireVerifier(ctx: CallerContext): void {
  if (!isPlatformStaff(ctx))
    throw new ForbiddenError('document verification requires platform staff')
}

export class InMemoryRenterDocumentRepository implements RenterDocumentRepository {
  private readonly store: Map<string, RenterDocument>

  constructor(store?: Map<string, RenterDocument>) {
    this.store = store ?? new Map()
  }

  async create(ctx: CallerContext, data: CreateRenterDocumentData): Promise<RenterDocument> {
    if (!isPlatformStaff(ctx) && data.renterId !== ctx.userId) {
      throw new ForbiddenError('cannot upload a document for another renter')
    }
    const now = new Date()
    const doc: RenterDocument = {
      id: crypto.randomUUID(),
      renterId: data.renterId,
      type: data.type,
      storageKey: data.storageKey,
      status: 'PENDING',
      expiryDate: null,
      verifiedAt: null,
      verifierId: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(doc.id, doc)
    return doc
  }

  async findByRenter(ctx: CallerContext, renterId: string): Promise<RenterDocument[]> {
    if (!isPlatformStaff(ctx) && renterId !== ctx.userId) return []
    return [...this.store.values()]
      .filter((d) => d.renterId === renterId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async findById(ctx: CallerContext, id: string): Promise<RenterDocument | undefined> {
    const doc = this.store.get(id)
    if (!doc) return undefined
    if (!isPlatformStaff(ctx) && doc.renterId !== ctx.userId) return undefined
    return doc
  }

  async listPending(
    ctx: CallerContext,
    filters?: RenterDocumentFilters,
  ): Promise<PaginatedResult<RenterDocument>> {
    requireVerifier(ctx)
    const pending = [...this.store.values()]
      .filter((d) => d.status === 'PENDING')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const offset = filters?.offset ?? 0
    const limit = filters?.limit ?? pending.length
    return { data: pending.slice(offset, offset + limit), total: pending.length }
  }

  async verify(
    ctx: CallerContext,
    id: string,
    verdict: DocumentVerifyInput,
  ): Promise<RenterDocument | undefined> {
    requireVerifier(ctx)
    const existing = this.store.get(id)
    if (!existing) return undefined
    const updated: RenterDocument = {
      ...existing,
      status: verdict.status,
      expiryDate: verdict.expiryDate ?? null,
      rejectionReason: verdict.rejectionReason ?? null,
      verifierId: verdict.verifierId,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    }
    this.store.set(updated.id, updated)
    return updated
  }

  async findApprovedByType(
    renterId: string,
    type: RenterDocument['type'],
  ): Promise<RenterDocument[]> {
    return [...this.store.values()].filter(
      (d) => d.renterId === renterId && d.type === type && d.status === 'APPROVED',
    )
  }
}
