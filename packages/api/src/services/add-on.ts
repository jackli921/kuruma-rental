import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { AddOn, AddOnFilters, AddOnRepository } from '../repositories/types'

export type AddOnResult = { ok: true; option: AddOn } | { ok: false; error: string; status: number }

const DUPLICATE_NAME_MESSAGE = 'An add-on with this name already exists'
const NOT_FOUND_MESSAGE = 'Add-on not found'

const isDuplicateName = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

export class AddOnService {
  constructor(private readonly repo: AddOnRepository) {}

  async findAll(ctx: CallerContext, filters?: AddOnFilters): Promise<AddOn[]> {
    return this.repo.findAll(ctx, filters)
  }

  async findById(ctx: CallerContext, id: string): Promise<AddOn | undefined> {
    return this.repo.findById(ctx, id)
  }

  /**
   * `data.operatorId` is resolved by the route (resolveOperatorIdForWrite), so
   * the service stays auth-mechanism-agnostic. Name is unique per operator among
   * ACTIVE rows only; the pre-check yields a friendly 409, the DB partial unique
   * index is the real seal.
   */
  async create(
    _ctx: CallerContext,
    data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AddOnResult> {
    const duplicate = await this.repo.findActiveByOperatorAndName(data.operatorId, data.name)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    // The pre-check is a UX nicety; the partial unique index is the real seal.
    // A concurrent insert can win the race after the check passes, so map the
    // resulting unique-violation to the same friendly 409 instead of a 500.
    try {
      const option = await this.repo.create(data)
      return { ok: true, option }
    } catch (err) {
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(ctx: CallerContext, id: string, data: Partial<AddOn>): Promise<AddOnResult> {
    // Caller-scoped existence check: an operator may only edit its own add-on.
    // A cross-tenant id reads as undefined here, so the write below never runs
    // and the caller sees 404 (not 403 — no cross-tenant existence leak).
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    if (data.name !== undefined && data.name !== existing.name) {
      const duplicate = await this.repo.findActiveByOperatorAndName(existing.operatorId, data.name)
      // Exclude the current row: a no-name-change edit can't self-collide, and
      // an ACTIVE duplicate under another id is a real clash.
      if (duplicate && duplicate.id !== id) {
        return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      }
    }

    try {
      const updated = await this.repo.update(id, data)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, option: updated }
    } catch (err) {
      // Same lost-race seal as create: a concurrent rename onto this name maps
      // to a friendly 409 rather than surfacing the raw unique-violation.
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async archive(ctx: CallerContext, id: string): Promise<AddOnResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const archived = await this.repo.archive(id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, option: archived }
  }
}
