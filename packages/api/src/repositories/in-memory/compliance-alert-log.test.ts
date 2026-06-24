import { describe, expect, test } from 'vitest'
import { complianceAlertKey } from '../types'
import { InMemoryComplianceAlertLogRepository } from './compliance-alert-log'

const base = {
  operatorId: 'op-1',
  vehicleId: 'veh-1',
  documentType: 'SHAKEN' as const,
  thresholdBand: 'D30' as const,
  recipient: 'a@example.com',
}

describe('InMemoryComplianceAlertLogRepository', () => {
  test('records distinct bands (in one batch) and exposes their keys', async () => {
    const repo = new InMemoryComplianceAlertLogRepository()
    await repo.recordMany([base, { ...base, documentType: 'INSURANCE', thresholdBand: 'D7' }])

    const keys = await repo.findAlertedKeys(['veh-1'])
    expect(keys).toEqual(
      new Set([
        complianceAlertKey('veh-1', 'SHAKEN', 'D30'),
        complianceAlertKey('veh-1', 'INSURANCE', 'D7'),
      ]),
    )
  })

  test('recordMany is idempotent on (vehicle, document, band) — a same-band re-run is a no-op', async () => {
    const store = new Map()
    const repo = new InMemoryComplianceAlertLogRepository(store)
    await repo.recordMany([base])
    await repo.recordMany([{ ...base, recipient: 'changed@example.com' }])

    expect(store.size).toBe(1)
    expect([...store.values()][0].recipient).toBe('a@example.com')
  })

  test('recordMany dedupes a same-band duplicate within a single batch', async () => {
    const store = new Map()
    const repo = new InMemoryComplianceAlertLogRepository(store)
    await repo.recordMany([base, { ...base, recipient: 'changed@example.com' }])

    expect(store.size).toBe(1)
    expect([...store.values()][0].recipient).toBe('a@example.com')
  })

  test('findAlertedKeys only returns keys for the requested vehicles', async () => {
    const repo = new InMemoryComplianceAlertLogRepository()
    await repo.recordMany([base, { ...base, vehicleId: 'veh-2' }])

    const keys = await repo.findAlertedKeys(['veh-1'])
    expect(keys).toEqual(new Set([complianceAlertKey('veh-1', 'SHAKEN', 'D30')]))
  })
})
