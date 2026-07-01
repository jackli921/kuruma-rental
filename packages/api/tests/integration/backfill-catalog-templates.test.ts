import {
  auditCatalogTemplates,
  backfillCatalogTemplates,
} from '@kuruma/shared/db/backfill-catalog-templates'
import { addOnOptions, addOnTemplates, operators } from '@kuruma/shared/db/schema'
import { slugify } from '@kuruma/shared/i18n/slugify'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from './setup'

// Slice 2a catalog backfill, end-to-end against real Postgres. `backfillCatalogTemplates`
// is the global one-off (it reads EVERY template + add_on_options row, like the
// region backfill), so this suite is isolation-safe the same way backfill-regions is:
// it seeds ONE dedicated operator with uniquely-keyed templates + prod-shaped fixture
// rows (case/punctuation name variants, an orphan, a slug-colliding duplicate pair)
// and asserts PER ROW by id + scopes the audit to its own operator, never on global
// counts (concurrent files seed their own add-ons).

// The shell is typed against the production neon-http handle; inject the
// structurally-identical postgres-js `testDb` (the cast every Drizzle repo here uses).
type ShellDb = Parameters<typeof backfillCatalogTemplates>[0]
const shellDb = db as unknown as ShellDb

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opId = `op_bf_${uniq}`

// Fixture names; each template key is slugify(name), so a row named a case/space
// variant of the name still maps onto the template.
const MAP_NAME = `Backfill Map ${uniq}`
const MERGE_NAME = `Backfill Merge ${uniq}`
const DESC_NAME = `Backfill Desc ${uniq}`
const ORPHAN_NAME = `Backfill Orphan ${uniq}`

const mapKey = slugify(MAP_NAME)
const mergeKey = slugify(MERGE_NAME)
const descKey = slugify(DESC_NAME)
const orphanKey = slugify(ORPHAN_NAME)

const tMapId = crypto.randomUUID()
const tMergeId = crypto.randomUUID()
const tDescId = crypto.randomUUID()

const bundle = (en: string) => ({ en, ja: `${en} JA`, zh: `${en} ZH` })

const optionRow = (over: {
  id: string
  name: string
  description?: string | null
  status?: 'ACTIVE' | 'ARCHIVED'
  createdAt?: Date
}) => ({
  id: over.id,
  operatorId: opId,
  name: over.name,
  description: over.description ?? null,
  templateId: null,
  priceJpy: 1000,
  status: over.status ?? ('ACTIVE' as const),
  createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00Z'),
})

const fetchOption = async (id: string) => {
  const [row] = await db.select().from(addOnOptions).where(eq(addOnOptions.id, id))
  return row
}
const fetchTemplate = async (id: string) => {
  const [row] = await db.select().from(addOnTemplates).where(eq(addOnTemplates.id, id))
  return row
}

let report: Awaited<ReturnType<typeof backfillCatalogTemplates>>
let auditBefore: Awaited<ReturnType<typeof auditCatalogTemplates>>
let auditAfter: Awaited<ReturnType<typeof auditCatalogTemplates>>

const myRowIds = ['map', 'orphan', 'merge_keep', 'merge_lose', 'desc'].map((s) => `bf_${s}_${uniq}`)
const [mapRowId, orphanRowId, mergeKeepId, mergeLoseId, descRowId] = myRowIds

describe('catalog template backfill (slice 2a)', () => {
  beforeAll(async () => {
    await db.insert(operators).values({ id: opId, slug: `bf-${uniq}`, name: 'Backfill Operator' })
    await db.insert(addOnTemplates).values([
      { id: tMapId, key: mapKey, name: bundle('Map'), description: bundle('Map desc en.') },
      { id: tMergeId, key: mergeKey, name: bundle('Merge'), description: bundle('Merge desc en.') },
      { id: tDescId, key: descKey, name: bundle('Desc'), description: bundle('Desc default en.') },
    ])
    await db.insert(addOnOptions).values([
      // Case/punctuation variant of MAP_NAME -> slugifies onto tMap.
      optionRow({ id: mapRowId, name: `BACKFILL  MAP  ${uniq}` }),
      // Orphan: no template has this key -> mints an ARCHIVED en-only template.
      optionRow({ id: orphanRowId, name: ORPHAN_NAME, description: 'Orphan blurb.' }),
      // Duplicate pair: both slugify to mergeKey; neither customized; oldest kept.
      optionRow({
        id: mergeKeepId,
        name: MERGE_NAME,
        description: 'Merge desc en.',
        createdAt: new Date('2020-01-01T00:00:00Z'),
      }),
      optionRow({
        id: mergeLoseId,
        name: `backfill  merge  ${uniq}`,
        description: 'Merge desc en.',
        createdAt: new Date('2021-01-01T00:00:00Z'),
      }),
      // Customized description differing from the template en default -> override.
      optionRow({ id: descRowId, name: DESC_NAME, description: 'My own wording.' }),
    ])

    auditBefore = await auditCatalogTemplates(shellDb)
    report = await backfillCatalogTemplates(shellDb)
    auditAfter = await auditCatalogTemplates(shellDb)
  })

  afterAll(async () => {
    await db.delete(addOnOptions).where(eq(addOnOptions.operatorId, opId))
    await db
      .delete(addOnTemplates)
      .where(inArray(addOnTemplates.key, [mapKey, mergeKey, descKey, orphanKey]))
    await db.delete(operators).where(eq(operators.id, opId))
  })

  it('maps a case/punctuation name variant onto the matching template, no override', async () => {
    const row = await fetchOption(mapRowId)
    expect(row?.templateId).toBe(tMapId)
    expect(row?.status).toBe('ACTIVE')
    expect(row?.descriptionOverride).toBeNull()
  })

  it('mints an ARCHIVED en-only template for an orphan and migrates its description', async () => {
    const row = await fetchOption(orphanRowId)
    expect(row?.status).toBe('ACTIVE')
    expect(row?.descriptionOverride).toEqual({ en: 'Orphan blurb.' })
    expect(row?.templateId).not.toBeNull()

    const minted = await fetchTemplate(row?.templateId as string)
    expect(minted?.key).toBe(orphanKey)
    expect(minted?.status).toBe('ARCHIVED')
    expect(minted?.name).toEqual({ en: ORPHAN_NAME })
    expect(minted?.description).toBeNull()
  })

  it('merges a slug-colliding duplicate pair: oldest stays ACTIVE, newer ARCHIVED', async () => {
    const keep = await fetchOption(mergeKeepId)
    const lose = await fetchOption(mergeLoseId)
    expect(keep?.status).toBe('ACTIVE')
    expect(keep?.templateId).toBe(tMergeId)
    expect(lose?.status).toBe('ARCHIVED')
    expect(lose?.templateId).toBe(tMergeId)
  })

  it('migrates a customized description into a { en } override', async () => {
    const row = await fetchOption(descRowId)
    expect(row?.templateId).toBe(tDescId)
    expect(row?.descriptionOverride).toEqual({ en: 'My own wording.' })
    expect(row?.status).toBe('ACTIVE')
  })

  it('reports at least this fixture set (rows mapped, template minted, duplicate merged)', () => {
    expect(report.mapped).toBeGreaterThanOrEqual(5)
    expect(report.minted).toBeGreaterThanOrEqual(1)
    expect(report.mergedDuplicates).toBeGreaterThanOrEqual(1)
  })

  it('audit: fixture rows were all null before and none remain null after', () => {
    for (const id of myRowIds) expect(auditBefore.nullTemplateIdRowIds).toContain(id)
    for (const id of myRowIds) expect(auditAfter.nullTemplateIdRowIds).not.toContain(id)
  })

  it('audit: no ACTIVE duplicate template group remains for the operator', () => {
    const mine = auditAfter.duplicateActiveTemplateGroups.filter((g) => g.operatorId === opId)
    expect(mine).toEqual([])
  })

  it('is idempotent: a second run changes none of the fixture rows or their template', async () => {
    await backfillCatalogTemplates(shellDb)

    expect((await fetchOption(mapRowId))?.templateId).toBe(tMapId)
    expect((await fetchOption(mergeLoseId))?.status).toBe('ARCHIVED')
    expect((await fetchOption(descRowId))?.descriptionOverride).toEqual({ en: 'My own wording.' })

    const orphanTemplates = await db
      .select()
      .from(addOnTemplates)
      .where(eq(addOnTemplates.key, orphanKey))
    expect(orphanTemplates).toHaveLength(1)

    const stillClean = (await auditCatalogTemplates(shellDb)).duplicateActiveTemplateGroups.filter(
      (g) => g.operatorId === opId,
    )
    expect(stillClean).toEqual([])
  })
})
