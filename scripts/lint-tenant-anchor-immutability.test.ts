import { describe, expect, test } from 'bun:test'
import {
  EXEMPTIONS,
  type RepoFile,
  findViolations,
  hasDrizzleSeal,
  inMemoryReconstructsUnpinned,
  introspectOperatorScopedExports,
  runLint,
  setPayloads,
  setSpreadsPayload,
  setWritesOperatorId,
  updatedTableExports,
} from './lint-tenant-anchor-immutability'

describe('updatedTableExports', () => {
  test('extracts the export name from each .update(x) call', () => {
    const src = 'this.db.update(locations).set({}); this.db.update(vehicleClasses).set({})'
    expect(updatedTableExports(src)).toEqual(['locations', 'vehicleClasses'])
  })

  test('is empty when the repo never calls .update()', () => {
    expect(updatedTableExports('this.db.select().from(regions)')).toEqual([])
  })
})

describe('setPayloads', () => {
  test('captures the .set() payload up to the chained .where(), excluding the WHERE', () => {
    const src = '.set({ ...fields, updatedAt: now }).where(eq(locations.operatorId, x))'
    expect(setPayloads(src)).toEqual(['{ ...fields, updatedAt: now })'])
  })

  test('does not read the WHERE clause operatorId as a written key', () => {
    const src = '.set({ name: input.name }).where(and(eq(t.id, id), eq(t.operatorId, s)))'
    expect(setWritesOperatorId(src)).toBe(false)
  })
})

describe('setSpreadsPayload', () => {
  test('true when the payload spreads an object', () => {
    expect(setSpreadsPayload('.set({ ...fields, updatedAt: now }).where(x)')).toBe(true)
  })

  test('false for an explicit-key payload (status transition)', () => {
    expect(setSpreadsPayload(".set({ status: 'CANCELLED', updatedAt: now }).where(x)")).toBe(false)
  })

  test('false for a sql template with interpolation but no spread', () => {
    expect(setSpreadsPayload('.set({ status: sql`${t.attempts} + 1` }).where(x)')).toBe(false)
  })
})

describe('setWritesOperatorId', () => {
  test('true when operatorId is an explicit key in .set()', () => {
    expect(setWritesOperatorId('.set({ operatorId: input.operatorId }).where(x)')).toBe(true)
  })

  test('false when operatorId only appears in the WHERE', () => {
    expect(setWritesOperatorId('.set({ name: n }).where(eq(t.operatorId, s))')).toBe(false)
  })

  test('ignores a Map.set(k, v) that is not a Drizzle inline .set({})', () => {
    expect(setWritesOperatorId('byOperator.set(m.operatorId, [...existing, m])')).toBe(false)
  })
})

describe('hasDrizzleSeal', () => {
  test('true when operatorId is destructured to a discard binding', () => {
    expect(hasDrizzleSeal('const { id: _id, operatorId: _operatorId, ...fields } = data')).toBe(
      true,
    )
  })

  test('false when operatorId is not stripped', () => {
    expect(hasDrizzleSeal('const { id: _id, ...fields } = data')).toBe(false)
  })
})

describe('inMemoryReconstructsUnpinned', () => {
  test('true when caller data is spread over existing without a pin', () => {
    const src = 'const updated = { ...existing, ...patch, updatedAt: new Date() }'
    expect(inMemoryReconstructsUnpinned(src)).toBe(true)
  })

  test('false when operatorId is pinned to the existing row', () => {
    const src =
      'const updated = { ...existing, ...data, operatorId: existing.operatorId, updatedAt: new Date() }'
    expect(inMemoryReconstructsUnpinned(src)).toBe(false)
  })

  test('false for a single-spread object with explicit keys (no caller spread)', () => {
    const src = 'const refreshed = { ...existing, recipient: data.recipient, locale: data.locale }'
    expect(inMemoryReconstructsUnpinned(src)).toBe(false)
  })

  test('false when the only extra spreads are array/member spreads in a property', () => {
    const src = 'const updated = { ...existing, photos: [...existing.photos, ...urls] }'
    expect(inMemoryReconstructsUnpinned(src)).toBe(false)
  })
})

describe('findViolations', () => {
  const opExports = new Set(['locations'])

  const sealedDrizzle = (): RepoFile => ({
    path: 'drizzle/location.ts',
    layer: 'drizzle',
    basename: 'location',
    source:
      'update() { const { operatorId: _operatorId, ...fields } = data; this.db.update(locations).set({ ...fields }).where(eq(locations.id, id)) }',
  })
  const pinnedInMemory = (): RepoFile => ({
    path: 'in-memory/location.ts',
    layer: 'in-memory',
    basename: 'location',
    source:
      'update() { this.db.update(locations); const updated = { ...existing, ...data, operatorId: existing.operatorId } }',
  })

  test('no violations when the drizzle repo seals and the in-memory repo pins', () => {
    expect(findViolations([sealedDrizzle(), pinnedInMemory()], opExports)).toEqual([])
  })

  test('flags a drizzle repo that spreads without stripping operatorId', () => {
    const unsealed: RepoFile = {
      path: 'drizzle/location.ts',
      layer: 'drizzle',
      basename: 'location',
      source: 'this.db.update(locations).set({ ...data }).where(eq(locations.id, id))',
    }
    expect(findViolations([unsealed], opExports)).toEqual([
      { path: 'drizzle/location.ts', basename: 'location', kind: 'drizzle-spread-unsealed' },
    ])
  })

  test('flags a drizzle repo that writes operatorId as an explicit key', () => {
    const writes: RepoFile = {
      path: 'drizzle/location.ts',
      layer: 'drizzle',
      basename: 'location',
      source: 'this.db.update(locations).set({ operatorId: data.operatorId }).where(x)',
    }
    expect(findViolations([writes], opExports)).toEqual([
      { path: 'drizzle/location.ts', basename: 'location', kind: 'drizzle-writes-operatorId' },
    ])
  })

  test('flags an in-memory repo (paired to an op-scoped drizzle repo) that does not pin', () => {
    const unpinned: RepoFile = {
      path: 'in-memory/location.ts',
      layer: 'in-memory',
      basename: 'location',
      source: 'const updated = { ...existing, ...data, updatedAt: new Date() }',
    }
    expect(findViolations([sealedDrizzle(), unpinned], opExports)).toEqual([
      { path: 'in-memory/location.ts', basename: 'location', kind: 'in-memory-unpinned' },
    ])
  })

  test('does not flag an in-memory repo whose table is NOT operator-scoped', () => {
    const notScoped: RepoFile = {
      path: 'in-memory/region.ts',
      layer: 'in-memory',
      basename: 'region',
      source: 'const updated = { ...existing, ...data, updatedAt: new Date() }',
    }
    expect(findViolations([notScoped], opExports)).toEqual([])
  })

  test('an exemption suppresses both the drizzle and the in-memory finding', () => {
    const drizzle: RepoFile = {
      path: 'drizzle/review.ts',
      layer: 'drizzle',
      basename: 'review',
      source: 'this.db.update(locations).set({ ...patch }).where(x)',
    }
    const inMemory: RepoFile = {
      path: 'in-memory/review.ts',
      layer: 'in-memory',
      basename: 'review',
      source: 'const updated = { ...existing, ...patch, updatedAt: new Date() }',
    }
    const exemptions = new Map([['review', 'test reason']])
    expect(findViolations([drizzle, inMemory], opExports, exemptions)).toEqual([])
  })
})

describe('EXEMPTIONS', () => {
  test('every exemption carries a non-empty reason', () => {
    for (const [name, reason] of EXEMPTIONS) {
      expect(reason.length, `${name} exemption needs a reason`).toBeGreaterThan(0)
    }
  })
})

describe('integration: the live repositories', () => {
  const base = new URL('../packages/', import.meta.url).pathname
  const opts = {
    schemaPath: `${base}shared/src/db/schema.ts`,
    drizzleDir: `${base}api/src/repositories/drizzle`,
    inMemoryDir: `${base}api/src/repositories/in-memory`,
  }

  test('the six known operator-scoped tables are introspected as non-null', async () => {
    const exports = await introspectOperatorScopedExports(opts.schemaPath)
    for (const t of [
      'vehicles',
      'vehicleClasses',
      'locations',
      'feeSchedules',
      'insuranceOptions',
      'addOnOptions',
    ]) {
      expect(exports.has(t), `${t} should be operator-scoped`).toBe(true)
    }
  })

  test('every live operator-scoped repo keeps operatorId immutable', async () => {
    const violations = await runLint(opts)
    expect(violations).toEqual([])
  })
})
