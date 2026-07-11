import type { Locale } from '@kuruma/shared/i18n/locales'
import type { LocalizedText, LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { OperatorAddOnData } from '@kuruma/shared/types/add-on'
import type { CallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  AddOnFilters,
  AddOnRepository,
  AddOnTemplateRepository,
  AddOnWithTemplate,
} from '../repositories/types'
import {
  type CrossOperatorRead,
  applyCrossOperatorReadScope,
  assertFleetWriteWithinOperator,
  fleetWriteDenialResult,
} from '../tenancy'
import { resolveAddOnDescription, resolveAddOnName } from './add-on-resolve'
import type { DescriptionTranslator } from './description-translation'

export type AddOnResult =
  | { ok: true; option: OperatorAddOnData }
  // code carries the #1456 OPERATOR_REQUIRED discriminator through failResult.
  | { ok: false; error: string; status: number; code?: ErrorCode }

/**
 * Catalog i18n: a create is one of two shapes (#1437). Either it PICKS a platform
 * TEMPLATE (`templateId`, which supplies the localized name) or it is SELF-AUTHORED
 * (`nameI18n`, the operator's own bundle). Exactly one is set — the route validator
 * (createAddOnSchema refine) guarantees it; the service branches on `nameI18n`. The
 * `name` column mirror is stamped from `template.name.en` (picked) or `nameI18n.en`
 * (self-authored). operatorId is resolved by the route (resolveOperatorIdForWrite).
 */
export type AddOnCreate = {
  operatorId: string
  templateId?: string | undefined
  nameI18n?: LocalizedText | undefined
  descriptionOverride: LocalizedTextOverride | null
  priceJpy: number
}

/**
 * The writable surface of an add-on PATCH. Owned by the service so a route passes
 * an intent DTO instead of the persistence entity (#1213 — routes never import
 * from ../stores). Price + description override are always editable; `nameI18n` is
 * editable ONLY for a self-authored row (D5 — add ja/zh or fix en later). A PICKED
 * row's name comes from the template, so the service rejects a nameI18n edit on it
 * (a friendly 4xx — the guard needs the row, so it lives here, not in the validator).
 */
export type AddOnUpdate = {
  priceJpy?: number
  descriptionOverride?: LocalizedTextOverride | null
  nameI18n?: LocalizedText
}

const DUPLICATE_TEMPLATE_MESSAGE = 'You already offer this add-on'
const DUPLICATE_NAME_MESSAGE = 'You already offer an add-on with this name'
const UNKNOWN_TEMPLATE_MESSAGE = 'Unknown or unavailable add-on template'
const CATALOG_DISABLED_MESSAGE = 'The shared catalog is disabled; create a custom add-on instead'
const PICKED_RENAME_MESSAGE =
  'A template-based add-on cannot be renamed; its name comes from the catalog'
const MISSING_IDENTITY_MESSAGE = 'An add-on needs either a template or a custom name'
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
    nameI18n: row.nameI18n,
    priceJpy: row.priceJpy,
    status: row.status,
  }
}

export class AddOnService {
  // #1437: the SHARED_CATALOG kill-switch. Defaults to ON, mirroring the registry
  // serverDefault (and the feature's fail-OPEN stance) so existing callers/tests need
  // no change; the composition root injects the real flag-backed thunk.
  constructor(
    private readonly repo: AddOnRepository,
    private readonly templateRepo: AddOnTemplateRepository,
    // #1318: REQUIRED (no default). A no-op default would fail to degraded output
    // (source-only, no error) on a forgotten wiring; a required param fails at
    // compile time instead. Wired in index.ts; tests pass a fake explicitly.
    private readonly descriptionTranslator: DescriptionTranslator,
    private readonly isSharedCatalogEnabled: () => Promise<boolean> = () => Promise.resolve(true),
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
   * Model B fill (#1318). MT owns the non-source locales of a SELF-AUTHORED
   * description, refreshed on every save. Returns the bag to persist.
   *
   * - Picked rows (HIGH-1): verbatim — their other locales resolve through the
   *   curated template description; MT would shadow human text with machine text.
   * - No source slot (HIGH-2): verbatim — `?locale=` defaults to `en` and the API
   *   is source-agnostic (Trip.com), so a ja-only bag sent without `?locale=ja`
   *   must not be coerced to null / re-based.
   */
  private async resolveDescriptionOverride(
    isSelfAuthored: boolean,
    locale: Locale,
    incoming: LocalizedTextOverride | null,
  ): Promise<LocalizedTextOverride | null> {
    if (!isSelfAuthored) return incoming
    if (incoming === null) return null
    const sourceText = incoming[locale]
    if (!sourceText) return incoming
    return this.descriptionTranslator.fill(locale, sourceText)
  }

  /**
   * `data.operatorId` is resolved by the route (resolveOperatorIdForWrite), so the
   * service stays auth-mechanism-agnostic. A create is PICKED (`templateId`) or
   * SELF-AUTHORED (`nameI18n`) — the route validator guarantees exactly one; branch
   * on `nameI18n`. The direct-call `MISSING_IDENTITY` guard is a belt-and-suspenders
   * for callers that bypass the validator (never null-name-insert).
   */
  async create(_ctx: CallerContext, data: AddOnCreate, locale: Locale): Promise<AddOnResult> {
    const descriptionOverride = await this.resolveDescriptionOverride(
      data.nameI18n != null,
      locale,
      data.descriptionOverride,
    )
    const resolved: AddOnCreate = { ...data, descriptionOverride }
    if (data.nameI18n) return this.createSelfAuthored(resolved, data.nameI18n, locale)
    if (data.templateId) {
      // Kill-switch: picking from the shared catalog is server-enforced. When off, the
      // operator must self-author (the escape hatch above stays open). Checked here, so
      // a client that bypasses the hidden picker still cannot pick a template. 422 (not
      // 403): the request is well-formed and the caller is authorized — the catalog is
      // just disabled — so this is a state, not an authz denial (surfacing != authz).
      if (!(await this.isSharedCatalogEnabled())) {
        return { ok: false, error: CATALOG_DISABLED_MESSAGE, status: 422 }
      }
      return this.createFromTemplate(resolved, data.templateId, locale)
    }
    return { ok: false, error: MISSING_IDENTITY_MESSAGE, status: 400 }
  }

  // Picked create: the template supplies the name. We resolve its en value for the
  // `name` column and dup-check on templateId among the operator's ACTIVE rows. The
  // picker excludes already-offered templates, so the 409 is a race backstop; the DB
  // partial unique (operatorId, templateId WHERE ACTIVE) is the real seal.
  private async createFromTemplate(
    data: AddOnCreate,
    templateId: string,
    locale: Locale,
  ): Promise<AddOnResult> {
    // Only an ACTIVE template may be newly offered (a retired one is never in the
    // picker). An unknown/archived id is a client error, not a 500 FK violation.
    const template = await this.templateRepo.findById(templateId)
    if (!template || template.status !== 'ACTIVE') {
      return { ok: false, error: UNKNOWN_TEMPLATE_MESSAGE, status: 400 }
    }

    const duplicate = await this.repo.findActiveByOperatorAndTemplate(data.operatorId, templateId)
    if (duplicate) return { ok: false, error: DUPLICATE_TEMPLATE_MESSAGE, status: 409 }

    // A picked create writes name = template.name.en, which shares the active-name
    // index with self-authored rows (§4.5). If the operator already offers a
    // self-authored item of that exact name, this is a NAME clash — report it as one
    // (the operator can archive that item) rather than a misleading "template" 409.
    const nameClash = await this.repo.findActiveByOperatorAndName(data.operatorId, template.name.en)
    if (nameClash) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    try {
      const option = await this.repo.create({
        operatorId: data.operatorId,
        // The template owns the localized name; the column carries its en value as
        // a legacy fallback until slice 5 drops it.
        name: template.name.en,
        description: null,
        templateId,
        descriptionOverride: data.descriptionOverride,
        nameI18n: null,
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

  // Self-authored create: the operator owns the name bundle. The `name` column
  // mirrors nameI18n.en so ordering, the active-name unique seal, and the booking
  // snapshot keep working. Dup-check on that mirror — self-authored and picked rows
  // share the name index, so a same-name clash across shapes is intentional (§4.5).
  // The catch maps ONLY the name unique (templateId is null, so the template partial
  // unique treats it as distinct and never fires).
  private async createSelfAuthored(
    data: AddOnCreate,
    nameI18n: LocalizedText,
    locale: Locale,
  ): Promise<AddOnResult> {
    const duplicate = await this.repo.findActiveByOperatorAndName(data.operatorId, nameI18n.en)
    if (duplicate) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }

    try {
      const option = await this.repo.create({
        operatorId: data.operatorId,
        name: nameI18n.en,
        description: null,
        templateId: null,
        descriptionOverride: data.descriptionOverride,
        nameI18n,
        priceJpy: data.priceJpy,
        status: 'ACTIVE',
      })
      return { ok: true, option: toOperatorAddOn(option, locale) }
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async update(
    ctx: CallerContext,
    id: string,
    data: AddOnUpdate,
    locale: Locale,
    actingOperatorId?: string,
  ): Promise<AddOnResult> {
    // Caller-scoped existence check: an operator may only edit its own add-on.
    // A cross-tenant id reads as undefined here, so the write below never runs
    // and the caller sees 404 (not 403 — no cross-tenant existence leak).
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // #1456: a bypass admin reads every operator's add-on by raw id, so bind this
    // write to the operator it picked — no pick -> 422, wrong pick -> 404. Runs
    // before the identity/rename checks so a mismatch never probes them. An operator
    // session is already tenant-clamped, so it passes through.
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    // D5: a nameI18n edit is SELF-AUTHORED-only. A picked row's name is the
    // template's — reject the rename with a friendly 4xx so it never reaches the DB
    // not-both CHECK (which would surface as a 500/23514).
    if (data.nameI18n && existing.templateId !== null) {
      return { ok: false, error: PICKED_RENAME_MESSAGE, status: 400 }
    }

    // Re-seal active_name_unique: when nameI18n.en changes, the `name` mirror moves
    // with it. Pre-check the new name (excluding this row — a no-change edit can't
    // self-collide) so a clash is a friendly 409, not a raw unique-violation.
    const fields: AddOnUpdate & { name?: string } = { ...data }
    if (data.nameI18n) {
      const nextName = data.nameI18n.en
      if (nextName !== existing.name) {
        const duplicate = await this.repo.findActiveByOperatorAndName(existing.operatorId, nextName)
        if (duplicate && duplicate.id !== id) {
          return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
        }
      }
      fields.name = nextName
    }

    try {
      const updated = await this.repo.update(ctx, id, fields)
      if (!updated) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
      return { ok: true, option: toOperatorAddOn(updated, locale) }
    } catch (err) {
      // Lost-race seal (a concurrent rename onto this name), mirroring create.
      if (isUniqueViolation(err)) return { ok: false, error: DUPLICATE_NAME_MESSAGE, status: 409 }
      throw err
    }
  }

  async archive(
    ctx: CallerContext,
    id: string,
    locale: Locale,
    actingOperatorId?: string,
  ): Promise<AddOnResult> {
    // Same caller-scoped guard as update — load before mutate so a cross-tenant
    // id can never be archived.
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }

    // #1456: bind the archive to the picked operator (see update()).
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND_MESSAGE)

    const archived = await this.repo.archive(ctx, id)
    if (!archived) return { ok: false, error: NOT_FOUND_MESSAGE, status: 404 }
    return { ok: true, option: toOperatorAddOn(archived, locale) }
  }
}
