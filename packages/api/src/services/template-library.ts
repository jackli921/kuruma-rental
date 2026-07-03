import { slugify } from '@kuruma/shared/i18n/slugify'
import type {
  TemplateAdminRow,
  TemplateCreate,
  TemplateLibraryResponse,
  TemplatePatch,
} from '@kuruma/shared/types/template-admin'
import {
  type CallerContext,
  ConflictError,
  NotFoundError,
  requirePlatformAdmin,
  requirePlatformRead,
} from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type {
  AddOnTemplateRepository,
  InsuranceTemplateRepository,
  TemplateCreateInput,
} from '../repositories/types'
import type { AddOnTemplate, InsuranceTemplate } from '../stores'

/** A template repo viewed as just its create seam — both catalogs share it. */
type TemplateCreator = {
  create(input: TemplateCreateInput): Promise<AddOnTemplate | InsuranceTemplate>
}

/**
 * Project a persisted template onto the admin wire row (@kuruma/shared): the
 * multi-locale `name` / `description` bundles reach the admin RAW (it curates
 * them), unlike the operator picker which resolves one label. Timestamps are
 * dropped — the library list has no use for them. Add-on and insurance rows are
 * structurally identical, so one projector serves both.
 */
function toRow(t: AddOnTemplate | InsuranceTemplate): TemplateAdminRow {
  return { id: t.id, key: t.key, name: t.name, description: t.description, status: t.status }
}

/**
 * Platform-admin template library (#1319). Cross-tenant by nature (the catalogs
 * are platform-global), so the read is gated by `requirePlatformRead` here in the
 * service — defence in depth behind the route's structural `/admin/*` guard — and
 * OPERATOR_* / RENTER / PARTNER are rejected. Returns EVERY status so the admin can
 * see and promote the ARCHIVED, en-only rows the slice-2/3 backfills mint.
 */
export class TemplateLibraryService {
  constructor(
    private readonly addOnTemplateRepo: AddOnTemplateRepository,
    private readonly insuranceTemplateRepo: InsuranceTemplateRepository,
  ) {}

  async listAll(ctx: CallerContext): Promise<TemplateLibraryResponse> {
    requirePlatformRead(ctx)
    const [addOns, insurance] = await Promise.all([
      this.addOnTemplateRepo.findAll(),
      this.insuranceTemplateRepo.findAll(),
    ])
    return { addOns: addOns.map(toRow), insurance: insurance.map(toRow) }
  }

  /**
   * Curate one add-on template — translate/edit its bundles and/or promote an
   * ARCHIVED backfill-minted row to ACTIVE (#1319 slice 2). A WRITE, so gated by
   * the stricter `requirePlatformAdmin` (read-floor `requirePlatformRead` admits
   * the whole platform tier; a write must not). The 403 is asserted BEFORE the
   * lookup so a missing id never leaks existence to a non-admin. Returns the raw
   * admin row; throws `NotFoundError` (-> 404) when no row matches.
   */
  async updateAddOn(
    ctx: CallerContext,
    id: string,
    patch: TemplatePatch,
  ): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    const updated = await this.addOnTemplateRepo.update(id, patch)
    if (!updated) throw new NotFoundError('add-on template not found')
    return toRow(updated)
  }

  /** Curate one insurance template — same contract as {@link updateAddOn} over
   *  the insurance catalog. */
  async updateInsurance(
    ctx: CallerContext,
    id: string,
    patch: TemplatePatch,
  ): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    const updated = await this.insuranceTemplateRepo.update(id, patch)
    if (!updated) throw new NotFoundError('insurance template not found')
    return toRow(updated)
  }

  /**
   * Add a new add-on template to the catalog (#1319 slice 3). A WRITE, so gated
   * by `requirePlatformAdmin` first. The client never sends `key` — it is derived
   * from `slugify(name.en)` so a hand-created template keys the same way a seed or
   * backfill one does; a clash on the DB's `*_key_unique` (23505) surfaces as a
   * 409 (a template with that name already exists) rather than a 500.
   */
  async createAddOn(ctx: CallerContext, data: TemplateCreate): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    return insertTemplate(this.addOnTemplateRepo, data)
  }

  /** Add a new insurance template — same contract as {@link createAddOn}. */
  async createInsurance(ctx: CallerContext, data: TemplateCreate): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    return insertTemplate(this.insuranceTemplateRepo, data)
  }
}

/**
 * Derive the `key` and insert, mapping the key-unique 23505 to a 409. Shared by
 * both catalogs (the create seam is identical); the caller applies the write gate
 * before this runs. A concurrent insert can also lose the key race, so the same
 * ConflictError covers both the pre-existing row and the lost race — no 500.
 */
async function insertTemplate(
  repo: TemplateCreator,
  data: TemplateCreate,
): Promise<TemplateAdminRow> {
  const input: TemplateCreateInput = {
    key: slugify(data.name.en),
    name: data.name,
    description: data.description,
    status: data.status,
  }
  try {
    return toRow(await repo.create(input))
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
      throw new ConflictError(`a template with key "${input.key}" already exists`)
    }
    throw err
  }
}
