import type { Locale } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import type { OperatorAddOnData } from '@kuruma/shared/types/add-on'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  AddOnFilters,
  AddOnRepository,
  AddOnTemplateRepository,
  AddOnWithTemplate,
} from '../repositories/types'
import { type CrossOperatorRead, applyCrossOperatorReadScope } from '../tenancy'
import { resolveAddOnDescription, resolveAddOnName } from './add-on-resolve'

export type AddOnResult =
  | { ok: true; option: OperatorAddOnData }
  | { ok: false; error: string; status: number }

/**
 * Catalog i18n (slice 2): a create picks a platform TEMPLATE (which supplies the
 * localized name) + an optional description override + a price. The operatorId is
 * resolved by the route (resolveOperatorIdForWrite); the service resolves the
 * template's en name for the still-NOT-NULL `name` column and dup-checks on
 * templateId, not free text.
 */
export type AddOnCreate = {
  operatorId: string
  templateId: string
  descriptionOverride: LocalizedTextOverride | null
  priceJpy: number
}

/**
 * The writable surface of an add-on PATCH. Owned by the service so a route passes
 * an intent DTO instead of the persistence entity (#1213 — routes never import
 * from ../stores). The template (an add-on's identity) is fixed at create, so an
 * edit only touches the price and the description override.
 */
export type AddOnUpdate = {
  priceJpy?: number
  descriptionOverride?: LocalizedTextOverride | null
}

const DUPLICATE_TEMPLATE_MESSAGE = 'You already offer this add-on'
const UNKNOWN_TEMPLATE_MESSAGE = 'Unknown or unavailable add-on template'
const NOT_FOUND_MESSAGE = 'Add-on not found'

const isUniqueViolation = (err: unknown): boolean => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION

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
  constructor(
    private readonly repo: AddOnRepository,
    private readonly templateRepo: AddOnTemplateRepository,
  ) {}

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
   * the service stays auth-mechanism-agnostic. The template supplies the name:
   * we resolve its en value for the still-NOT-NULL `name` column (PR1 window) and
   * dup-check on templateId among the operator's ACTIVE rows. The picker excludes
   * already-offered templates, so the 409 is only a race backstop; the DB partial
   * unique index (operatorId, templateId WHERE ACTIVE) is the real seal.
   */
  async create(_ctx: CallerContext, data: AddOnCreate, locale: Locale): Promise<AddOnResult> {
    // Only an ACTIVE template may be newly offered (a retired one is never in the
    // picker). An unknown/archived id is a client error, not a 500 FK violation.
    const template = await this.templateRepo.findById(data.templateId)
    if (!template || template.status !== 'ACTIVE') {
      return { ok: false, error: UNKNOWN_TEMPLATE_MESSAGE, status: 400 }
    }

    const duplicate = await this.repo.findActiveByOperatorAndTemplate(
      data.operatorId,
      data.templateId,
    )
    if (duplicate) return { ok: false, error: DUPLICATE_TEMPLATE_MESSAGE, status: 409 }

    try {
      const option = await this.repo.create({
        operatorId: data.operatorId,
        // The template owns the localized name; the column carries its en value as
        // a legacy fallback until slice 5 drops it.
        name: template.name.en,
        description: null,
        templateId: data.templateId,
        descriptionOverride: data.descriptionOverride,
        priceJpy: data.priceJpy,
        status: 'ACTIVE',
      })
      return { ok: true, option: toOperatorAddOn(option, locale) }
    } catch (err) {
      // A concurrent insert can win the race after the pre-check passes; map the
      // resulting unique-violation to the same friendly 409 instead of a 500.
      if (isUniqueViolation(err)) {
        return { ok: false, error: DUPLICATE_TEMPLATE_MESSAGE, status: 409 }
      }
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

    // Only price + description override are editable — the template (the add-on's
    // identity) is fixed, so there is no name-uniqueness clash to guard here.
    const updated = await this.repo.update(ctx, id, data)
    if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, option: toOperatorAddOn(updated, locale) }
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
