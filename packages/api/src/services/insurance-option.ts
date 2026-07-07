import type { Locale } from '@kuruma/shared/i18n/locales'
import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type { InsuranceOptionData } from '@kuruma/shared/types/insurance-option'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  InsuranceOption,
  InsuranceOptionFilters,
  InsuranceOptionRepository,
} from '../repositories/types'
import { type CrossOperatorRead, applyCrossOperatorReadScope } from '../tenancy'
import { resolveInsuranceName } from './insurance-resolve'

export type InsuranceOptionResult =
  | { ok: true; option: InsuranceOptionData }
  | { ok: false; error: string; status: number }

/**
 * Project a read row to the operator wire DTO, resolving `nameI18n` to the caller
 * locale (catalog i18n slice 3b). The multi-locale bundle stays server-side; the
 * wire carries one resolved label + the raw `nameI18n` bag so the edit form can
 * show/edit the authored-locale slots. Dates render as ISO strings (JSON has no
 * Date) — the operator wire keeps timestamps (unlike the add-on DTO).
 */
function toInsuranceOptionData(row: InsuranceOption, locale: Locale): InsuranceOptionData {
  return {
    id: row.id,
    operatorId: row.operatorId,
    resolvedName: resolveInsuranceName(row, locale),
    nameI18n: row.nameI18n,
    description: row.description,
    dailyPriceJpy: row.dailyPriceJpy,
    deductibleJpy: row.deductibleJpy,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * The create intent (#1437 slice 3). Insurance is purely self-authored, so the
 * caller supplies `nameI18n` (en required) and the service derives the `name`
 * mirror (= nameI18n.en) — the ACTIVE-name unique seal + booking-snapshot source.
 * `nameI18n` is REQUIRED so a route that forgets to forward it fails typecheck.
 * Server-derived columns (id/status/timestamps) are absent.
 */
export type InsuranceOptionCreate = {
  operatorId: string
  nameI18n: LocalizedText
  description: string | null
  dailyPriceJpy: number
  deductibleJpy: number | null
}

/**
 * The writable surface of an insurance-option PATCH. Owned by the service so a
 * route passes an intent DTO instead of the persistence entity (#1213 — routes
 * never import from ../stores). Server-derived columns (id/operatorId/timestamps)
 * are absent. `nameI18n` re-derives the `name` mirror (D5: operators may add
 * ja/zh or fix en later); the picked-vs-self-authored branch never applies.
 */
export type InsuranceOptionUpdate = {
  nameI18n?: LocalizedText
  description?: string | null
  dailyPriceJpy?: number
  deductibleJpy?: number | null
}

const DUPLICATE_NAME_MESSAGE = 'An insurance option with this name already exists'
const NOT_FOUND_MESSAGE = 'Insurance option not found'

const isDuplicateName = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

export class InsuranceOptionService {
  constructor(private readonly repo: InsuranceOptionRepository) {}

  async findAll(
    ctx: CallerContext,
    read: CrossOperatorRead,
    filters: InsuranceOptionFilters,
    locale: Locale,
  ): Promise<InsuranceOptionData[]> {
    const rows = await this.repo.findAll(ctx, applyCrossOperatorReadScope(ctx, read, filters))
    return rows.map((row) => toInsuranceOptionData(row, locale))
  }

  async findById(
    ctx: CallerContext,
    id: string,
    locale: Locale,
  ): Promise<InsuranceOptionData | undefined> {
    const row = await this.repo.findById(ctx, id)
    return row ? toInsuranceOptionData(row, locale) : undefined
  }

  /**
   * `data.operatorId` is resolved by the route (resolveOperatorIdForWrite), so
   * the service stays auth-mechanism-agnostic. Name is unique per operator among
   * ACTIVE rows only; the pre-check yields a friendly 409, the DB partial unique
   * index is the real seal.
   */
  async create(
    _ctx: CallerContext,
    data: InsuranceOptionCreate,
    locale: Locale,
  ): Promise<InsuranceOptionResult> {
    // The `name` column mirrors nameI18n.en — the ACTIVE-name unique seal, the
    // asc(name) ordering key, and the booking-snapshot source (#1437 slice 3).
    const name = data.nameI18n.en
    const duplicate = await this.repo.findActiveByOperatorAndName(data.operatorId, name)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    // The pre-check is a UX nicety; the partial unique index is the real seal.
    // A concurrent insert can win the race after the check passes, so map the
    // resulting unique-violation to the same friendly 409 instead of a 500.
    try {
      const option = await this.repo.create({
        operatorId: data.operatorId,
        name,
        nameI18n: data.nameI18n,
        description: data.description,
        dailyPriceJpy: data.dailyPriceJpy,
        deductibleJpy: data.deductibleJpy,
        status: 'ACTIVE',
      })
      return { ok: true, option: toInsuranceOptionData(option, locale) }
    } catch (err) {
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: InsuranceOptionUpdate,
    locale: Locale,
  ): Promise<InsuranceOptionResult> {
    // Caller-scoped existence check: an operator may only edit its own option.
    // A cross-tenant id reads as undefined here, so the write below never runs
    // and the caller sees 404 (not 403 — no cross-tenant existence leak).
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // A nameI18n edit re-derives the `name` mirror (D5: add ja/zh or fix en later);
    // dup-check the new en value against other ACTIVE rows.
    const nextName = data.nameI18n?.en
    if (nextName !== undefined && nextName !== existing.name) {
      const duplicate = await this.repo.findActiveByOperatorAndName(existing.operatorId, nextName)
      // Exclude the current row: a no-name-change edit can't self-collide, and
      // an ACTIVE duplicate under another id is a real clash.
      if (duplicate && duplicate.id !== id) {
        return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      }
    }

    try {
      // Keep the `name` mirror in lockstep with the bundle's en on every write.
      const patch: Partial<InsuranceOption> = { ...data }
      if (data.nameI18n) patch.name = data.nameI18n.en
      const updated = await this.repo.update(ctx, id, patch)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, option: toInsuranceOptionData(updated, locale) }
    } catch (err) {
      // Same lost-race seal as create: a concurrent rename onto this name maps
      // to a friendly 409 rather than surfacing the raw unique-violation.
      if (isDuplicateName(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async archive(ctx: CallerContext, id: string, locale: Locale): Promise<InsuranceOptionResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    const archived = await this.repo.archive(ctx, id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, option: toInsuranceOptionData(archived, locale) }
  }
}
