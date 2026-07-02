import type { Locale } from '@kuruma/shared/i18n/locales'
import type { OperatorAddOnData } from '@kuruma/shared/types/add-on'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { AddOn, AddOnFilters, AddOnRepository, AddOnWithTemplate } from '../repositories/types'
import { type CrossOperatorRead, applyCrossOperatorReadScope } from '../tenancy'
import { resolveAddOnDescription, resolveAddOnName } from './add-on-resolve'

export type AddOnResult =
  | { ok: true; option: OperatorAddOnData }
  | { ok: false; error: string; status: number }

/**
 * The writable surface of an add-on PATCH. Owned by the service so a route passes
 * an intent DTO instead of the persistence entity (#1213 — routes never import
 * from ../stores). Server-derived columns (id/operatorId/timestamps) are absent.
 * Catalog i18n (slice 2): the free-text `name`/`description` write path stays here
 * through the PR1 window; Phase 3 swaps it for the templateId picker.
 */
export type AddOnUpdate = Partial<Pick<AddOn, 'name' | 'description' | 'priceJpy'>>

const DUPLICATE_NAME_MESSAGE = 'An add-on with this name already exists'
const NOT_FOUND_MESSAGE = 'Add-on not found'

const isDuplicateName = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

/**
 * Project a joined read row to the operator wire DTO, resolving the template
 * name/description to the caller locale (catalog i18n slice 2). The multi-locale
 * bundle stays server-side; the wire carries one resolved label + the raw
 * `descriptionOverride` bag so the edit form can show the authored-locale slot.
 */
function toOperatorAddOn(row: AddOnWithTemplate, locale: Locale): OperatorAddOnData {
  return {
    id: row.id,
    operatorId: row.operatorId,
    templateId: row.templateId,
    resolvedName: resolveAddOnName(row, locale),
    resolvedDescription: resolveAddOnDescription(row, locale),
    descriptionOverride: row.descriptionOverride,
    priceJpy: row.priceJpy,
    status: row.status,
  }
}

export class AddOnService {
  constructor(private readonly repo: AddOnRepository) {}

  async findAll(
    ctx: CallerContext,
    read: CrossOperatorRead,
    filters: AddOnFilters,
    locale: Locale,
  ): Promise<OperatorAddOnData[]> {
    const rows = await this.repo.findAll(ctx, applyCrossOperatorReadScope(ctx, read, filters))
    return rows.map((row) => toOperatorAddOn(row, locale))
  }

  async findById(
    ctx: CallerContext,
    id: string,
    locale: Locale,
  ): Promise<OperatorAddOnData | undefined> {
    const row = await this.repo.findById(ctx, id)
    return row ? toOperatorAddOn(row, locale) : undefined
  }

  /**
   * `data.operatorId` is resolved by the route (resolveOperatorIdForWrite), so
   * the service stays auth-mechanism-agnostic. Name is unique per operator among
   * ACTIVE rows only; the pre-check yields a friendly 409, the DB partial unique
   * index is the real seal. The response resolves to the caller locale.
   */
  async create(
    _ctx: CallerContext,
    data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>,
    locale: Locale,
  ): Promise<AddOnResult> {
    const duplicate = await this.repo.findActiveByOperatorAndName(data.operatorId, data.name)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    // The pre-check is a UX nicety; the partial unique index is the real seal.
    // A concurrent insert can win the race after the check passes, so map the
    // resulting unique-violation to the same friendly 409 instead of a 500.
    try {
      const option = await this.repo.create(data)
      return { ok: true, option: toOperatorAddOn(option, locale) }
    } catch (err) {
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: AddOnUpdate,
    locale: Locale,
  ): Promise<AddOnResult> {
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
      const updated = await this.repo.update(ctx, id, data)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, option: toOperatorAddOn(updated, locale) }
    } catch (err) {
      // Same lost-race seal as create: a concurrent rename onto this name maps
      // to a friendly 409 rather than surfacing the raw unique-violation.
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async archive(ctx: CallerContext, id: string, locale: Locale): Promise<AddOnResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const archived = await this.repo.archive(ctx, id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, option: toOperatorAddOn(archived, locale) }
  }
}
