import { addOnOptions, addOnTemplates, operators } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAddOnRepository,
  DrizzleAddOnTemplateRepository,
} from '../../src/repositories/drizzle'
import { AddOnService } from '../../src/services/add-on'
import type { AddOn } from '../../src/stores'
import { db } from './setup'

// Catalog i18n (slice 2) against real Postgres. Proves what the in-memory double
// can't: the add-on -> template LEFT JOIN carries the multi-locale bundle (and
// keeps legacy null-templateId rows), the templateId FK (23503), the PARTIAL
// active-template unique index (two ACTIVE same (operatorId, templateId) -> 23505;
// archive frees it), and the full JOIN -> `?locale=` resolution through the service.

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

const PG_UNIQUE_VIOLATION = '23505'
const PG_FK_VIOLATION = '23503'
const PG_CHECK_VIOLATION = '23514'
const violationCode = (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (err) => pgErrorCode(err),
  )

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opReadId = `op_addon_read_${uniq}`
const opDupId = `op_addon_dup_${uniq}`
const opFkId = `op_addon_fk_${uniq}`
const opLocaleId = `op_addon_loc_${uniq}`
const opSelfId = `op_addon_self_${uniq}`
const allOpIds = [opReadId, opDupId, opFkId, opLocaleId, opSelfId]

const CHILD_SEAT_KEY = `test_tmpl_child_${uniq}`
const childSeatId = crypto.randomUUID()
const CHILD_SEAT_NAME = { en: 'Child seat', ja: 'チャイルドシート', zh: '儿童座椅' }

const addOnInput = (
  operatorId: string,
  templateId: string | null,
  name: string,
): Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name,
  description: null,
  templateId,
  descriptionOverride: null,
  nameI18n: null,
  priceJpy: 1500,
  status: 'ACTIVE',
})

// A SELF-AUTHORED row (#1437): templateId null, nameI18n set, name mirrors en.
const selfAuthoredInput = (
  operatorId: string,
  nameI18n: { en: string; ja?: string; zh?: string },
): Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name: nameI18n.en,
  description: null,
  templateId: null,
  descriptionOverride: null,
  nameI18n,
  priceJpy: 1500,
  status: 'ACTIVE',
})

const repo = new DrizzleAddOnRepository(db)

beforeAll(async () => {
  await db
    .insert(operators)
    .values(allOpIds.map((id) => ({ id, slug: `addon-${id}`, name: `AddOn Operator ${id}` })))
  await db.insert(addOnTemplates).values({
    id: childSeatId,
    key: CHILD_SEAT_KEY,
    name: CHILD_SEAT_NAME,
    description: null,
    status: 'ACTIVE',
  })
})

afterAll(async () => {
  await db.delete(addOnOptions).where(inArray(addOnOptions.operatorId, allOpIds))
  await db.delete(operators).where(inArray(operators.id, allOpIds))
  await db.delete(addOnTemplates).where(inArray(addOnTemplates.key, [CHILD_SEAT_KEY]))
})

describe('add-on <-> template JOIN read (Drizzle)', () => {
  it('carries the picked template id and its full localized name bundle', async () => {
    const created = await repo.create(addOnInput(opReadId, childSeatId, 'Child seat'))
    expect(created.templateId).toBe(childSeatId)
    expect(created.templateName).toEqual(CHILD_SEAT_NAME)

    const readBack = await repo.findById(ctxFor(opReadId), created.id)
    expect(readBack?.templateName).toEqual(CHILD_SEAT_NAME)
  })

  it('LEFT JOIN still returns a legacy null-templateId row (PR1 window) with a null bundle', async () => {
    const legacy = await repo.create(addOnInput(opReadId, null, `Legacy extra ${uniq}`))
    expect(legacy.templateId).toBeNull()
    expect(legacy.templateName).toBeNull()

    const ids = (await repo.findAll(ctxFor(opReadId))).map((a) => a.id)
    expect(ids).toContain(legacy.id)
  })
})

describe('add-on template FK + active-template uniqueness (Drizzle)', () => {
  it('rejects an add-on whose templateId has no template row (23503)', async () => {
    expect(
      await violationCode(repo.create(addOnInput(opFkId, crypto.randomUUID(), 'Orphan'))),
    ).toBe(PG_FK_VIOLATION)
  })

  it('rejects a second ACTIVE add-on for the same (operatorId, templateId) (23505)', async () => {
    await repo.create(addOnInput(opDupId, childSeatId, 'Child seat'))
    expect(await violationCode(repo.create(addOnInput(opDupId, childSeatId, 'Child seat')))).toBe(
      PG_UNIQUE_VIOLATION,
    )
  })

  it('archiving the add-on frees the template so the operator can offer it again', async () => {
    const active = (await repo.findActiveByOperatorAndTemplate(opDupId, childSeatId))?.id
    if (!active) throw new Error('expected the seeded dup add-on to be active')
    await repo.archive(ctxFor(opDupId), active)
    const recreated = await repo.create(addOnInput(opDupId, childSeatId, 'Child seat'))
    expect(recreated.status).toBe('ACTIVE')
    expect(recreated.id).not.toBe(active)
  })
})

describe('add-on self-authored path (#1437, Drizzle)', () => {
  const service = new AddOnService(repo, new DrizzleAddOnTemplateRepository(db))

  it('round-trips a self-authored nameI18n bundle through jsonb (no template)', async () => {
    const bundle = { en: 'GPS unit', ja: 'GPS ユニット', zh: 'GPS 装置' }
    const created = await repo.create(selfAuthoredInput(opSelfId, bundle))
    expect(created.templateId).toBeNull()
    expect(created.templateName).toBeNull()
    expect(created.nameI18n).toEqual(bundle)

    const readBack = await repo.findById(ctxFor(opSelfId), created.id)
    expect(readBack?.nameI18n).toEqual(bundle)
  })

  it('resolves a self-authored name to the requested locale through the service', async () => {
    const res = await service.create(
      ctxFor(opSelfId),
      {
        operatorId: opSelfId,
        nameI18n: { en: 'Dashcam', ja: 'ドライブレコーダー' },
        descriptionOverride: null,
        priceJpy: 3000,
      },
      'ja',
    )
    expect(res).toMatchObject({
      ok: true,
      option: { resolvedName: 'ドライブレコーダー', templateId: null },
    })
  })

  it('the DB CHECK rejects a row carrying BOTH a templateId and a nameI18n (23514)', async () => {
    expect(
      await violationCode(
        repo.create({
          ...addOnInput(opSelfId, childSeatId, `Both ${uniq}`),
          nameI18n: { en: `Both ${uniq}` },
        }),
      ),
    ).toBe(PG_CHECK_VIOLATION)
  })

  it('seals a self-authored name under active_name_unique (second ACTIVE same name -> 23505)', async () => {
    await repo.create(selfAuthoredInput(opSelfId, { en: `Unique ${uniq}` }))
    expect(
      await violationCode(repo.create(selfAuthoredInput(opSelfId, { en: `Unique ${uniq}` }))),
    ).toBe(PG_UNIQUE_VIOLATION)
  })
})

describe('add-on ?locale= resolution through the service (Drizzle)', () => {
  const service = new AddOnService(repo, new DrizzleAddOnTemplateRepository(db))

  it('resolves the template name to the requested locale on create', async () => {
    const res = await service.create(
      ctxFor(opLocaleId),
      {
        operatorId: opLocaleId,
        templateId: childSeatId,
        descriptionOverride: null,
        priceJpy: 2000,
      },
      'ja',
    )
    expect(res).toMatchObject({ ok: true, option: { resolvedName: 'チャイルドシート' } })
  })

  it('resolves the same row to a different locale on read', async () => {
    const zh = await service.findAll(ctxFor(opLocaleId), { includeAll: false }, {}, 'zh')
    expect(zh.map((a) => a.resolvedName)).toContain('儿童座椅')
  })
})
