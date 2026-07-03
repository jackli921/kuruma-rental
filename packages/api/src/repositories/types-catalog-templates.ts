import type { CatalogTemplateStatus } from '@kuruma/shared/enums'
import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import type { AddOnTemplate, InsuranceTemplate } from '../stores'

// Platform-owned catalog TEMPLATE repositories (catalog i18n, epic #385 / #1319).
// Split into their own module to keep the repositories/types barrel under the
// file-size cap; re-exported there so callers' imports don't change.

/**
 * New-template columns the admin create supplies (#1319 slice 3). The service
 * derives `key` (`slugify(name.en)`) and defaults `description`/`status`, then
 * hands the repo this fully-resolved row minus the DB-generated id + timestamps.
 * Shared by both catalogs (add-on and insurance templates are identical shapes).
 */
export interface TemplateCreateInput {
  key: string
  name: LocalizedText
  description: LocalizedText | null
  status: CatalogTemplateStatus
}

/**
 * The platform-owned add-on TEMPLATE catalog (catalog i18n, epic #385). Global,
 * not tenant-scoped — every operator picks from the same list — so NO ctx: a
 * template carries no operator, and the read exposes only ACTIVE rows (a picker
 * never offers a retired template). The service resolves each row's LocalizedText
 * name to the caller locale before it reaches the wire.
 */
export interface AddOnTemplateRepository {
  findActive(): Promise<AddOnTemplate[]>
  /**
   * EVERY template regardless of status, key-ordered — the platform-admin library
   * read (#1319). Distinct from `findActive` (the operator picker): the admin must
   * see the ARCHIVED, en-only rows the slice-2 backfill mints so it can translate
   * and promote them. Never reaches an operator/renter.
   */
  findAll(): Promise<AddOnTemplate[]>
  /**
   * Look up ONE template by id — the write-path primitive (catalog i18n slice 2):
   * a create resolves the picked template's en name for the still-NOT-NULL `name`
   * column. NOT status-filtered (returns ARCHIVED too); the create service applies
   * the ACTIVE-only policy. Undefined when no row matches.
   */
  findById(id: string): Promise<AddOnTemplate | undefined>
  /**
   * Curate ONE template — the platform-admin write (#1319 slice 2). A single
   * partial serves both intents: translate/edit the `name` / `description`
   * bundles and promote/archive via `status` (promote = `{ status: 'ACTIVE' }`
   * on a backfill-minted ARCHIVED row). Bumps `updatedAt`. Returns the updated
   * row, or undefined when no row matches (a 404 for the service, never a throw).
   */
  update(id: string, patch: TemplatePatch): Promise<AddOnTemplate | undefined>
  /**
   * Add a new template to the catalog (#1319 slice 3). `key` is unique
   * (`add_on_templates_key_unique`); a clash throws a 23505 the service maps to a
   * 409 (a template with that name already exists). Returns the inserted row.
   */
  create(input: TemplateCreateInput): Promise<AddOnTemplate>
}

/**
 * The platform-owned insurance TEMPLATE catalog (catalog i18n, slice 3). Mirrors
 * {@link AddOnTemplateRepository} but over `insurance_templates`. Global, not
 * tenant-scoped, so no ctx. `findAll` powers the platform-admin library (#1319) —
 * the insurance catalog had no repository until now (only schema + backfill + seed),
 * so this is its first read path.
 */
export interface InsuranceTemplateRepository {
  /** EVERY template regardless of status, key-ordered — the admin library read. */
  findAll(): Promise<InsuranceTemplate[]>
  /** One template by id, any status; undefined when no row matches. */
  findById(id: string): Promise<InsuranceTemplate | undefined>
  /** Curate ONE template — the admin write (#1319 slice 2). Same partial + bump
   *  as the add-on catalog; undefined when no row matches. */
  update(id: string, patch: TemplatePatch): Promise<InsuranceTemplate | undefined>
  /** Add a new insurance template (#1319 slice 3). Same contract as the add-on
   *  catalog's `create`; a duplicate `key` throws a 23505 (-> 409). */
  create(input: TemplateCreateInput): Promise<InsuranceTemplate>
}
