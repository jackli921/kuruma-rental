import { featureFlags } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { DrizzleFeatureFlagRepository } from '../../src/repositories/drizzle'
import { db } from './setup'

// feature_flags is a global platform table (no operator scope). This suite is the
// only writer, so it owns cleanup of the keys it touches.
const TOUCHED = ['MULTI_CURRENCY', 'REVIEWS'] as const

describe('DrizzleFeatureFlagRepository (real pg)', () => {
  const repo = new DrizzleFeatureFlagRepository(db)

  afterAll(async () => {
    await db.delete(featureFlags).where(inArray(featureFlags.key, [...TOUCHED]))
  })

  it('starts with no override for an untouched key', async () => {
    const overrides = await repo.getOverrides()
    expect(overrides.MULTI_CURRENCY).toBeUndefined()
  })

  it('upserts an override and reads it back in the sparse map', async () => {
    await repo.setOverride('MULTI_CURRENCY', true, 'admin_pg_1')
    const overrides = await repo.getOverrides()
    expect(overrides.MULTI_CURRENCY).toBe(true)
  })

  it('upsert on the same key overwrites the prior value (no duplicate row)', async () => {
    await repo.setOverride('REVIEWS', true, 'admin_pg_1')
    await repo.setOverride('REVIEWS', false, 'admin_pg_2')

    const overrides = await repo.getOverrides()
    expect(overrides.REVIEWS).toBe(false)

    const rows = await db.select().from(featureFlags)
    expect(rows.filter((r) => r.key === 'REVIEWS')).toHaveLength(1)
  })

  it('stamps the platform admin who last set the override', async () => {
    await repo.setOverride('REVIEWS', true, 'admin_pg_3')
    const rows = await db.select().from(featureFlags)
    const row = rows.find((r) => r.key === 'REVIEWS')
    expect(row?.updatedBy).toBe('admin_pg_3')
  })
})
