import { describe, expect, test } from 'vitest'
import type { ComplianceAlertLog } from '../../stores'
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

  test('findAlertedKeys only returns keys for the requested vehicles', async () => {
    const repo = new InMemoryComplianceAlertLogRepository()
    await repo.recordMany([base, { ...base, vehicleId: 'veh-2' }])

    const keys = await repo.findAlertedKeys(['veh-1'])
    expect(keys).toEqual(new Set([complianceAlertKey('veh-1', 'SHAKEN', 'D30')]))
  })

  describe('latestSentAtForOperator (#1120)', () => {
    const row = (id: string, operatorId: string, sentAt: Date): [string, ComplianceAlertLog] => [
      id,
      {
        id,
        operatorId,
        vehicleId: `veh-${id}`,
        documentType: 'SHAKEN',
        thresholdBand: 'D30',
        recipient: 'a@example.com',
        sentAt,
      },
    ]

    test('returns the most recent sentAt scoped to that operator', async () => {
      const store = new Map<string, ComplianceAlertLog>([
        row('1', 'op-1', new Date('2026-06-01T00:00:00Z')),
        row('2', 'op-1', new Date('2026-06-20T09:30:00Z')), // latest for op-1
        row('3', 'op-2', new Date('2026-06-25T00:00:00Z')), // newer, but other operator
      ])
      const repo = new InMemoryComplianceAlertLogRepository(store)
      expect(await repo.latestSentAtForOperator('op-1')).toEqual(new Date('2026-06-20T09:30:00Z'))
    })

    test('returns null when the operator has never been alerted', async () => {
      const repo = new InMemoryComplianceAlertLogRepository()
      await repo.recordMany([base])
      expect(await repo.latestSentAtForOperator('op-unknown')).toBeNull()
    })
  })
})
