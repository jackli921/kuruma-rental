import { eq } from 'drizzle-orm'
import {
  type CatalogAuditReport,
  type CatalogBackfillReport,
  planCatalogBackfill,
} from './backfill-catalog-templates'
import type { DbOrTx } from './index'
import { insuranceOptions, insuranceTemplates } from './pricing'

/**
 * One-off, idempotent insurance backfill (slice 3a): give every null-templateId
 * insurance_options row a template — mapping onto a curated/seed template by
 * slugify(name), minting an ARCHIVED en-only template for an orphan name, and
 * merging intra-operator duplicates — so slice-5 can flip the column NOT NULL.
 *
 * The map-or-mint-or-merge DECISION is the pure `planCatalogBackfill` shared with
 * the add-on catalog: insurance_status is the same {ACTIVE, ARCHIVED} pair, so an
 * insurance_options row fits AddOnRowFact as-is (reused per the slice-3 design).
 * This is the thin insurance SHELL — it reads rows, applies the plan against
 * insurance_templates/insurance_options, and reports.
 *
 * Injectable (DIP) like `backfillCatalogTemplates`, typed on `DbOrTx`: the prod
 * CLI wraps it in `runTx` (neon-http `getDb()` throws on `db.transaction`) so the
 * plan applies atomically. The apply order is load-bearing: ARCHIVE losers BEFORE
 * stamping keepers, or assigning a shared templateId to a second ACTIVE row trips
 * the partial unique `insurance_options_active_template_unique` (23505). Idempotent:
 * only null-templateId rows are stamped, so a fully-committed rerun is a no-op.
 */
export async function backfillInsuranceTemplates(db: DbOrTx): Promise<CatalogBackfillReport> {
  const templateRows = await db
    .select({
      id: insuranceTemplates.id,
      key: insuranceTemplates.key,
      name: insuranceTemplates.name,
      description: insuranceTemplates.description,
    })
    .from(insuranceTemplates)

  const optionRows = await db
    .select({
      id: insuranceOptions.id,
      operatorId: insuranceOptions.operatorId,
      name: insuranceOptions.name,
      description: insuranceOptions.description,
      status: insuranceOptions.status,
      templateId: insuranceOptions.templateId,
      createdAt: insuranceOptions.createdAt,
    })
    .from(insuranceOptions)

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
    await db.insert(insuranceTemplates).values({
      id: mint.id,
      key: mint.key,
      name: mint.name,
      description: null,
      status: 'ARCHIVED',
    })
  }
  for (const id of plan.archives) {
    await db.update(insuranceOptions).set({ status: 'ARCHIVED' }).where(eq(insuranceOptions.id, id))
  }
  for (const stamp of plan.stamps) {
    await db
      .update(insuranceOptions)
      .set({ templateId: stamp.templateId, descriptionOverride: stamp.descriptionOverride })
      .where(eq(insuranceOptions.id, stamp.id))
  }

  return {
    mapped: plan.stamps.length,
    minted: plan.mints.length,
    mergedDuplicates: plan.archives.length,
  }
}

/**
 * Read-only pre-PR2 gate (slice 5): names the OFFENDING insurance rows rather
 * than bare counts. Merge is safe to flip `insurance_options.templateId` NOT NULL
 * only when BOTH arrays are empty against prod-shaped data. Mirrors
 * `auditCatalogTemplates` on the insurance tables.
 */
export async function auditInsuranceTemplates(db: DbOrTx): Promise<CatalogAuditReport> {
  const rows = await db
    .select({
      id: insuranceOptions.id,
      operatorId: insuranceOptions.operatorId,
      templateId: insuranceOptions.templateId,
      status: insuranceOptions.status,
    })
    .from(insuranceOptions)

  const nullTemplateIdRowIds = rows
    .filter((r) => r.templateId === null)
    .map((r) => r.id)
    .sort()

  const groups = new Map<string, { operatorId: string; templateId: string; rowIds: string[] }>()
  for (const r of rows) {
    if (r.status !== 'ACTIVE' || r.templateId === null) continue
    // Composite (operatorId, templateId) key; a visible `::` delimiter neither
    // UUID part can contain keeps the intra-operator grouping collision-free.
    const key = `${r.operatorId}::${r.templateId}`
    const group = groups.get(key)
    if (group) group.rowIds.push(r.id)
    else groups.set(key, { operatorId: r.operatorId, templateId: r.templateId, rowIds: [r.id] })
  }
  const duplicateActiveTemplateGroups = [...groups.values()].filter((g) => g.rowIds.length > 1)

  return { nullTemplateIdRowIds, duplicateActiveTemplateGroups }
}
