import { eq, isNull } from 'drizzle-orm'
import type { AddOnStatus } from '../enums'
import type { LocalizedText, LocalizedTextOverride } from '../i18n/localized-text'
import { slugify } from '../i18n/slugify'
import { addOnOptions, addOnTemplates } from './add-on'
import type { DbOrTx } from './index'

// The pre-migration facts the planner reasons over — a template's identity plus
// its `en` bundle values (the only locale the merge/override decisions compare).
export interface TemplateFact {
  readonly id: string
  readonly key: string
  readonly enName: string
  readonly enDescription: string | null
}

// A single add_on_options row as the planner sees it (raw name/description
// columns + tenancy + status + current templateId + createdAt for the tiebreak).
export interface AddOnRowFact {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly description: string | null
  readonly status: AddOnStatus
  readonly templateId: string | null
  readonly createdAt: Date
}

// A template the backfill mints for an orphan name: ARCHIVED, en-only.
export interface MintedTemplate {
  readonly id: string
  readonly key: string
  readonly name: LocalizedText
}

// A null-templateId row gaining its templateId (+ migrated description override).
export interface RowStamp {
  readonly id: string
  readonly templateId: string
  readonly descriptionOverride: LocalizedTextOverride | null
}

// The ordered plan the DB shell applies: mint templates, ARCHIVE losers, THEN
// stamp rows. The archive-before-stamp order is load-bearing (see the shell).
export interface CatalogBackfillPlan {
  readonly mints: readonly MintedTemplate[]
  readonly archives: readonly string[]
  readonly stamps: readonly RowStamp[]
}

// Pure map-or-mint-or-merge decision (mirrors backfill-regions' `planRegionBackfill`).
// `newId` mints template ids so the caller controls id generation (crypto.randomUUID
// in prod, a counter in tests) while the planner stays deterministic.
export function planCatalogBackfill(
  templates: readonly TemplateFact[],
  rows: readonly AddOnRowFact[],
  newId: () => string,
): CatalogBackfillPlan {
  const idBySlug = new Map<string, string>()
  const enDescriptionById = new Map<string, string | null>()
  for (const t of templates) {
    idBySlug.set(t.key, t.id)
    enDescriptionById.set(t.id, t.enDescription)
  }

  // Pass 1 — map or mint. Resolve each null-templateId row's target template,
  // minting an ARCHIVED en-only template for an orphan name so a later row with
  // the same slug maps onto it (no second mint). Deterministic order so the mint
  // sequence + keeper tiebreaks are stable regardless of the DB's row order.
  const nullRows = sortByCreatedAtThenId(rows.filter((r) => r.templateId === null))
  const mints: MintedTemplate[] = []
  const targetByRowId = new Map<string, string>()
  for (const r of nullRows) {
    const slug = slugify(r.name)
    let templateId = idBySlug.get(slug)
    if (templateId === undefined) {
      templateId = newId()
      mints.push({ id: templateId, key: slug, name: { en: r.name } })
      idBySlug.set(slug, templateId)
      enDescriptionById.set(templateId, null)
    }
    targetByRowId.set(r.id, templateId)
  }

  const finalTemplateId = (r: AddOnRowFact): string | undefined =>
    r.templateId ?? targetByRowId.get(r.id)

  // Pass 2 — intra-operator merge. Among ACTIVE rows that will share an
  // (operatorId, templateId), keep one and archive the rest: the partial unique
  // `add_on_options_active_template_unique` forbids two such ACTIVE rows, so the
  // shell must ARCHIVE losers BEFORE stamping the keeper. Already-templated
  // ACTIVE rows count too — a null row colliding with one still merges.
  const activeGroups = new Map<string, AddOnRowFact[]>()
  for (const r of rows) {
    if (r.status !== 'ACTIVE') continue
    const templateId = finalTemplateId(r)
    if (templateId === undefined) continue
    const key = operatorTemplateKey(r.operatorId, templateId)
    const group = activeGroups.get(key)
    if (group) group.push(r)
    else activeGroups.set(key, [r])
  }

  const losers: AddOnRowFact[] = []
  for (const group of activeGroups.values()) {
    if (group.length < 2) continue
    const [, ...rest] = rankKeeperFirst(group, finalTemplateId, enDescriptionById)
    losers.push(...rest)
  }
  const archives = sortByCreatedAtThenId(losers).map((r) => r.id)

  // Pass 3 — stamp every null row with its target templateId (losers included:
  // every row needs a non-null templateId for the PR2 NOT NULL) and migrate a
  // customized description to a `{ en }` override.
  const stamps: RowStamp[] = nullRows.map((r) => {
    const templateId = targetByRowId.get(r.id)
    if (templateId === undefined) {
      throw new Error(`planCatalogBackfill: null-templateId row ${r.id} has no target template`)
    }
    return {
      id: r.id,
      templateId,
      descriptionOverride: overrideFor(r.description, enDescriptionById.get(templateId) ?? null),
    }
  })

  return { mints, archives, stamps }
}

// Order a duplicate group so the KEEPER is first: prefer a row whose description
// is a real customization (differs from the template `en`), then the oldest
// createdAt, then id — a total, deterministic order so re-runs are stable.
function rankKeeperFirst(
  group: readonly AddOnRowFact[],
  finalTemplateId: (r: AddOnRowFact) => string | undefined,
  enDescriptionById: ReadonlyMap<string, string | null>,
): AddOnRowFact[] {
  const isCustomized = (r: AddOnRowFact): boolean => {
    const templateId = finalTemplateId(r)
    const templateEn = templateId ? (enDescriptionById.get(templateId) ?? null) : null
    return r.description !== null && r.description !== templateEn
  }
  return [...group].sort(
    (a, b) =>
      Number(isCustomized(b)) - Number(isCustomized(a)) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      compareById(a, b),
  )
}

export interface CatalogBackfillReport {
  /** Previously-null add_on_options rows now pointing at a template. */
  readonly mapped: number
  /** New ARCHIVED templates minted for orphan names. */
  readonly minted: number
  /** ACTIVE rows archived because they duplicated another (operatorId, templateId). */
  readonly mergedDuplicates: number
}

/**
 * One-off, idempotent catalog backfill (slice 2a): give every null-templateId
 * add_on_options row a template — mapping onto a curated/seed template by
 * slugify(name), minting an ARCHIVED en-only template for an orphan name, and
 * merging intra-operator duplicates — so slice-5 can flip the column NOT NULL.
 *
 * Injectable (DIP) like `seed`/`backfillLocationRegions`, but typed on `DbOrTx`:
 * the prod CLI wraps it in `runTx` (the neon-http `getDb()` throws on
 * `db.transaction`) so it receives a TxHandle and the map-or-mint-or-merge runs
 * atomically. The decision is the pure `planCatalogBackfill`; this is the thin
 * shell that reads rows, applies the plan, and reports.
 *
 * The apply order is load-bearing: ARCHIVE losers BEFORE stamping keepers, or
 * assigning a shared templateId to a second ACTIVE row trips the partial unique
 * `add_on_options_active_template_unique` (23505). Idempotent: only null-templateId
 * rows are stamped, so a fully-committed rerun is a no-op.
 */
export async function backfillCatalogTemplates(db: DbOrTx): Promise<CatalogBackfillReport> {
  const templateRows = await db
    .select({
      id: addOnTemplates.id,
      key: addOnTemplates.key,
      name: addOnTemplates.name,
      description: addOnTemplates.description,
    })
    .from(addOnTemplates)

  const optionRows = await db
    .select({
      id: addOnOptions.id,
      operatorId: addOnOptions.operatorId,
      name: addOnOptions.name,
      description: addOnOptions.description,
      status: addOnOptions.status,
      templateId: addOnOptions.templateId,
      createdAt: addOnOptions.createdAt,
    })
    .from(addOnOptions)
    // Never touch a SELF-AUTHORED row (#1437): it is legitimately null-templateId but
    // stamping it a templateId would trip the add_on_options_not_both_identities CHECK.
    // Self-authored rows (nameI18n NOT NULL) are excluded; templated and legacy rows
    // (nameI18n NULL) still backfill as before. (Full backfill retirement: slice 3, D2.)
    .where(isNull(addOnOptions.nameI18n))

  const plan = planCatalogBackfill(
    templateRows.map((t) => ({
      id: t.id,
      key: t.key,
      enName: t.name.en,
      enDescription: t.description?.en ?? null,
    })),
    optionRows,
    () => crypto.randomUUID(),
  )

  for (const mint of plan.mints) {
    await db.insert(addOnTemplates).values({
      id: mint.id,
      key: mint.key,
      name: mint.name,
      description: null,
      status: 'ARCHIVED',
    })
  }
  for (const id of plan.archives) {
    await db.update(addOnOptions).set({ status: 'ARCHIVED' }).where(eq(addOnOptions.id, id))
  }
  for (const stamp of plan.stamps) {
    await db
      .update(addOnOptions)
      .set({ templateId: stamp.templateId, descriptionOverride: stamp.descriptionOverride })
      .where(eq(addOnOptions.id, stamp.id))
  }

  return {
    mapped: plan.stamps.length,
    minted: plan.mints.length,
    mergedDuplicates: plan.archives.length,
  }
}

export interface DuplicateActiveTemplateGroup {
  readonly operatorId: string
  readonly templateId: string
  readonly rowIds: readonly string[]
}

/**
 * INSURANCE audit report — insurance is still template-bound (its self-authored
 * cutover is #1437 slice 3), so its null-templateId gate is still genuine and
 * `auditInsuranceTemplates` returns this shape. The ADD-ON audit no longer uses it:
 * a self-authored add-on is legitimately null-templateId (#1437), so it returns the
 * narrowed {@link AddOnCatalogAuditReport} instead.
 */
export interface CatalogAuditReport {
  /** insurance_options ids still carrying a null templateId (must be empty before its NOT-NULL flip). */
  readonly nullTemplateIdRowIds: readonly string[]
  /** Operators holding two ACTIVE rows on one templateId (backfill must leave none). */
  readonly duplicateActiveTemplateGroups: readonly DuplicateActiveTemplateGroup[]
}

/**
 * ADD-ON audit report (#1437): the null-templateId gate is DROPPED — a self-authored
 * add-on is legitimately null-templateId, so flagging it is a false alarm. Only the
 * duplicate-template check remains (the partial unique already makes a duplicate
 * unreachable, so this is a cheap prod cross-check). The add-on backfill/audit fully
 * retires when slice 3 lands (design D2).
 */
export interface AddOnCatalogAuditReport {
  readonly duplicateActiveTemplateGroups: readonly DuplicateActiveTemplateGroup[]
}

/**
 * Read-only add-on audit: names operators holding two ACTIVE rows on one templateId
 * (mirrors backfill-regions' `unassigned: string[]`). The former null-templateId
 * half was removed (#1437) — a self-authored add-on is legitimately null there.
 */
export async function auditCatalogTemplates(db: DbOrTx): Promise<AddOnCatalogAuditReport> {
  const rows = await db
    .select({
      id: addOnOptions.id,
      operatorId: addOnOptions.operatorId,
      templateId: addOnOptions.templateId,
      status: addOnOptions.status,
    })
    .from(addOnOptions)

  const groups = new Map<string, { operatorId: string; templateId: string; rowIds: string[] }>()
  for (const r of rows) {
    if (r.status !== 'ACTIVE' || r.templateId === null) continue
    const key = operatorTemplateKey(r.operatorId, r.templateId)
    const group = groups.get(key)
    if (group) group.rowIds.push(r.id)
    else groups.set(key, { operatorId: r.operatorId, templateId: r.templateId, rowIds: [r.id] })
  }
  const duplicateActiveTemplateGroups = [...groups.values()].filter((g) => g.rowIds.length > 1)

  return { duplicateActiveTemplateGroups }
}

// Composite Map key for an (operatorId, templateId) pair. A visible delimiter
// neither UUID part can contain (matches seed-bookings' `::`) keeps the intra-
// operator grouping collision-free — and keeps a raw control byte out of the source.
function operatorTemplateKey(operatorId: string, templateId: string): string {
  return `${operatorId}::${templateId}`
}

// Byte-wise id order for a stable, runtime-independent tiebreak. localeCompare is
// ICU/locale-dependent and can differ across runtimes (Bun vs workerd, see #1216);
// ids are opaque, so a raw code-unit compare is both correct and deterministic.
function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sortByCreatedAtThenId(rows: readonly AddOnRowFact[]): AddOnRowFact[] {
  return [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compareById(a, b),
  )
}

// A row's `description` column migrates to a `{ en }` override only when it is a
// real customization — a non-null value that differs from the template's `en`
// default. An orphan whose template carries no `en` description (minted, en-name
// only) counts as customized, so its authored text is preserved.
function overrideFor(
  description: string | null,
  templateEnDescription: string | null,
): LocalizedTextOverride | null {
  if (description === null || description === templateEnDescription) return null
  return { en: description }
}
