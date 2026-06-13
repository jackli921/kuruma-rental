import { locations, operators, regions } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { PUBLIC_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleRegionRepository,
  DrizzleStorefrontRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #394: the region taxonomy is DB-only in two places the in-memory doubles can't
// exercise — DrizzleRegionRepository's recursive descendant resolution over real
// rows, and DrizzleStorefrontRepository's inArray region filter (incl. null-region
// exclusion). Plus the public GET /regions endpoint. Drives all three against
// Postgres.
describe('region taxonomy against Postgres (#394)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_region_${uniq}`
  // text PK ids; suffixed so they never collide with the seed or sibling tests.
  const id = (slug: string) => `reg_${slug}_${uniq}`
  const OSAKA = id('osaka')
  const OSAKA_CITY = id('osaka_city')
  const NAMBA = id('namba')
  const UMEDA = id('umeda')
  const KYOTO = id('kyoto')
  const KYOTO_CITY = id('kyoto_city')
  const KYOTO_STATION = id('kyoto_station')
  const locNambaId = `loc_namba_${uniq}`
  const locKyotoId = `loc_kyoto_${uniq}`
  const locNullId = `loc_null_${uniq}`

  const regionRepo = new DrizzleRegionRepository(db)
  const storefrontRepo = new DrizzleStorefrontRepository(db)

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(operators).values({ id: opId, slug: `region-${uniq}`, name: 'Region Op' })
    // Parents before children (self-FK). Trilingual names.
    await db.insert(regions).values([
      {
        id: OSAKA,
        parentId: null,
        nameEn: 'Osaka',
        nameJa: '大阪府',
        nameZh: '大阪府',
        sortOrder: 1,
      },
      { id: OSAKA_CITY, parentId: OSAKA, nameEn: 'Osaka City', nameJa: '大阪市', nameZh: '大阪市' },
      { id: NAMBA, parentId: OSAKA_CITY, nameEn: 'Namba', nameJa: '難波', nameZh: '难波' },
      { id: UMEDA, parentId: OSAKA_CITY, nameEn: 'Umeda', nameJa: '梅田', nameZh: '梅田' },
      {
        id: KYOTO,
        parentId: null,
        nameEn: 'Kyoto',
        nameJa: '京都府',
        nameZh: '京都府',
        sortOrder: 2,
      },
      { id: KYOTO_CITY, parentId: KYOTO, nameEn: 'Kyoto City', nameJa: '京都市', nameZh: '京都市' },
      {
        id: KYOTO_STATION,
        parentId: KYOTO_CITY,
        nameEn: 'Kyoto Station',
        nameJa: '京都駅',
        nameZh: '京都站',
      },
    ])
    const loc = (id: string, name: string, regionId: string | null) => ({
      id,
      operatorId: opId,
      name,
      address: `${name}, Japan`,
      regionId,
      status: 'ACTIVE' as const,
    })
    await db
      .insert(locations)
      .values([
        loc(locNambaId, 'Namba Store', NAMBA),
        loc(locKyotoId, 'Kyoto Store', KYOTO_STATION),
        loc(locNullId, 'No Region Store', null),
      ])
  })

  afterAll(async () => {
    await db.delete(locations).where(inArray(locations.operatorId, [opId]))
    await db
      .delete(regions)
      .where(
        inArray(regions.id, [KYOTO_STATION, KYOTO_CITY, KYOTO, UMEDA, NAMBA, OSAKA_CITY, OSAKA]),
      )
    await db.delete(operators).where(inArray(operators.id, [opId]))
  })

  it('DrizzleRegionRepository.findDescendantIds resolves the whole subtree (recursive)', async () => {
    const ids = await regionRepo.findDescendantIds(OSAKA)
    expect(new Set(ids)).toEqual(new Set([OSAKA, OSAKA_CITY, NAMBA, UMEDA]))
    expect(ids).not.toContain(KYOTO)
  })

  it('DrizzleRegionRepository.findDescendantIds(leaf) returns just that id', async () => {
    expect(await regionRepo.findDescendantIds(KYOTO_STATION)).toEqual([KYOTO_STATION])
  })

  it('DrizzleRegionRepository.findDescendantIds(unknown) returns empty', async () => {
    expect(await regionRepo.findDescendantIds(`reg_nope_${uniq}`)).toEqual([])
  })

  it('storefront repo keeps only locations in the region descendant set (incl. null exclusion)', async () => {
    const ids = await regionRepo.findDescendantIds(OSAKA)
    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT, { regionIds: ids })
    const myIds = result.map((s) => s.id)
    expect(myIds).toContain(locNambaId)
    expect(myIds).not.toContain(locKyotoId) // different prefecture
    expect(myIds).not.toContain(locNullId) // null regionId never matches a filter
  })

  it('storefront repo returns nothing for an empty region set', async () => {
    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT, { regionIds: [] })
    expect(result).toEqual([])
  })

  it('GET /regions returns the flat tree with trilingual names', async () => {
    const app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      regionRepo: new DrizzleRegionRepository(db),
    })
    const res = await app.request('/regions')
    expect(res.status).toBe(200)
    const body = await res.json()
    const namba = body.data.find((r: { id: string }) => r.id === NAMBA)
    expect(namba).toMatchObject({
      parentId: OSAKA_CITY,
      nameEn: 'Namba',
      nameJa: '難波',
      nameZh: '难波',
    })
  })
})
