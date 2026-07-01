import { describe, expect, it, vi } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryComplianceAlertLogRepository } from '../repositories/in-memory/compliance-alert-log'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { type ComplianceAlertLogRepository, complianceAlertKey } from '../repositories/types'
import type { Vehicle } from '../stores'
import { ComplianceDigestService, SCAN_LIMIT } from './compliance-digest'
import type { EmailMessage } from './email/email-sender'
import type { ResolveOperatorRecipientsBatch } from './operator-recipients'

const TODAY = '2026-09-01'
const EXPIRED = '2026-08-01' // before TODAY
const D7 = '2026-09-08' // 7 days out
const FAR = '2027-12-01' // > 30 days → no band

function makeVehicle(
  vehicleRepo: InMemoryVehicleRepository,
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_osaka',
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: FAR,
    insuranceExpiryDate: FAR,
    ...overrides,
  })
}

function fakeSender(ctrl: { fail: boolean } = { fail: false }) {
  const sent: EmailMessage[] = []
  return {
    sent,
    sender: {
      async send(message: EmailMessage) {
        if (ctrl.fail) throw new Error('provider down')
        sent.push(message)
        return { providerMessageId: `msg_${sent.length}` }
      },
    },
  }
}

const RECIPIENTS: Record<string, string[]> = {
  op_a: ['owner-a@op.example', 'staff-a@op.example'],
  op_b: ['owner-b@op.example'],
}
// #1010: the digest now resolves all operators in one batch call — the fake
// mirrors that shape (ids → map), so the service test exercises the real seam.
const resolveRecipients: ResolveOperatorRecipientsBatch = async (ids) =>
  new Map(ids.map((id) => [id, RECIPIENTS[id] ?? []]))

function setup(opts?: {
  ctrl?: { fail: boolean }
  alertLogRepo?: ComplianceAlertLogRepository
}) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const alertLogRepo = opts?.alertLogRepo ?? new InMemoryComplianceAlertLogRepository()
  const { sent, sender } = fakeSender(opts?.ctrl)
  const service = new ComplianceDigestService({
    vehicleRepo,
    alertLogRepo,
    resolveRecipients,
    emailSender: sender,
    today: () => TODAY,
    config: { emailFrom: 'fleet@platform.example' },
  })
  return { vehicleRepo, alertLogRepo, sent, service }
}

describe('ComplianceDigestService.run (#916 §5.4)', () => {
  it('sends one Bcc digest per operator listing each flagged document', async () => {
    const { vehicleRepo, alertLogRepo, sent, service } = setup()
    const v1 = await makeVehicle(vehicleRepo, { name: 'Prius', shakenExpiryDate: EXPIRED })
    const v2 = await makeVehicle(vehicleRepo, { name: 'Vitz', insuranceExpiryDate: D7 })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 1, alertsRecorded: 2 })
    expect(sent).toHaveLength(1)
    const mail = sent[0]!
    expect(mail.to).toBe('fleet@platform.example')
    expect(mail.from).toBe('fleet@platform.example')
    expect(mail.bcc).toEqual(['owner-a@op.example', 'staff-a@op.example'])
    expect(mail.subject).toContain('2') // item count
    expect(mail.html).toContain('Prius')
    expect(mail.html).toContain('Vitz')
    expect(mail.html).toContain('車検') // shaken (ja default)
    expect(mail.html).toContain('期限切れ') // EXPIRED band
    expect(mail.html).toContain('あと7日') // D7 band

    const keys = await alertLogRepo.findAlertedKeys([v1.id, v2.id])
    expect(keys).toContain(complianceAlertKey(v1.id, 'SHAKEN', 'EXPIRED'))
    expect(keys).toContain(complianceAlertKey(v2.id, 'INSURANCE', 'D7'))
  })

  it('flags a vehicle with no recorded document date (MISSING band)', async () => {
    const { vehicleRepo, alertLogRepo, sent, service } = setup()
    const v = await makeVehicle(vehicleRepo, { name: 'LegacyVan', shakenExpiryDate: null })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 1, alertsRecorded: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.html).toContain('LegacyVan')
    expect(sent[0]!.html).toContain('証明書未登録') // MISSING band, ja default
    const keys = await alertLogRepo.findAlertedKeys([v.id])
    expect(keys).toContain(complianceAlertKey(v.id, 'SHAKEN', 'MISSING'))
  })

  it('sends nothing when every document is outside all alert bands', async () => {
    const { vehicleRepo, sent, service } = setup()
    await makeVehicle(vehicleRepo, {}) // both FAR

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 0, alertsRecorded: 0 })
    expect(sent).toHaveLength(0)
  })

  it('alerts a band at most once across daily runs (idempotent)', async () => {
    const { vehicleRepo, sent, service } = setup()
    await makeVehicle(vehicleRepo, { shakenExpiryDate: EXPIRED })

    await service.run()
    const second = await service.run()

    expect(sent).toHaveLength(1)
    expect(second).toMatchObject({ operatorsNotified: 0, alertsRecorded: 0 })
  })

  it('does not record when the send fails, so the next run retries', async () => {
    const ctrl = { fail: true }
    const alertLogRepo = new InMemoryComplianceAlertLogRepository()
    const first = setup({ ctrl, alertLogRepo })
    const v = await makeVehicle(first.vehicleRepo, { shakenExpiryDate: EXPIRED })

    const failed = await first.service.run()
    expect(failed).toMatchObject({ operatorsNotified: 0, operatorsFailed: 1, alertsRecorded: 0 })
    expect(await alertLogRepo.findAlertedKeys([v.id])).toHaveProperty('size', 0)

    ctrl.fail = false
    const retry = await first.service.run()
    expect(retry).toMatchObject({ operatorsNotified: 1, alertsRecorded: 1 })
    expect(first.sent).toHaveLength(1)
  })

  it('skips an operator with no recipients without recording', async () => {
    const { vehicleRepo, alertLogRepo, sent, service } = setup()
    const v = await makeVehicle(vehicleRepo, { operatorId: 'op_orphan', shakenExpiryDate: EXPIRED })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 0, operatorsSkippedNoRecipients: 1 })
    expect(sent).toHaveLength(0)
    expect(await alertLogRepo.findAlertedKeys([v.id])).toHaveProperty('size', 0)
  })

  it('fans out per operator — each mail carries only that operator vehicles', async () => {
    const { vehicleRepo, sent, service } = setup()
    await makeVehicle(vehicleRepo, {
      operatorId: 'op_a',
      name: 'AlphaCar',
      shakenExpiryDate: EXPIRED,
    })
    await makeVehicle(vehicleRepo, {
      operatorId: 'op_b',
      name: 'BetaCar',
      shakenExpiryDate: EXPIRED,
    })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 2, alertsRecorded: 2 })
    expect(sent).toHaveLength(2)
    const aMail = sent.find((m) => m.bcc?.includes('owner-a@op.example'))!
    const bMail = sent.find((m) => m.bcc?.includes('owner-b@op.example'))!
    expect(aMail.html).toContain('AlphaCar')
    expect(aMail.html).not.toContain('BetaCar')
    expect(bMail.html).toContain('BetaCar')
    expect(bMail.html).not.toContain('AlphaCar')
  })

  it('excludes retired vehicles from the scan', async () => {
    const { vehicleRepo, sent, service } = setup()
    await makeVehicle(vehicleRepo, { status: 'RETIRED', shakenExpiryDate: EXPIRED })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 0 })
    expect(sent).toHaveLength(0)
  })

  it('a ledger-write failure for one operator does not abort the rest of the fleet (#1043)', async () => {
    // recordMany always rejects: every sent digest fails to seal. The fix guards
    // the write like the send, so the second operator still gets its mail instead
    // of the first operator's throw aborting the whole run.
    const failingLedger: ComplianceAlertLogRepository = {
      findAlertedKeys: async () => new Set<string>(),
      recordMany: async () => {
        throw new Error('ledger down')
      },
      latestSentAtForOperator: async () => null,
    }
    const { vehicleRepo, sent, service } = setup({ alertLogRepo: failingLedger })
    await makeVehicle(vehicleRepo, { operatorId: 'op_a', shakenExpiryDate: EXPIRED })
    await makeVehicle(vehicleRepo, { operatorId: 'op_b', shakenExpiryDate: EXPIRED })

    const summary = await service.run() // must not throw

    expect(sent).toHaveLength(2) // both operators emailed despite both seals failing
    expect(summary).toMatchObject({
      operatorsNotified: 2,
      alertsRecorded: 0,
      operatorsRecordFailed: 2,
      operatorsFailed: 0,
    })
  })

  it('flags fleetScanTruncated and warns when the scan fills the page (silent-cap guard, #1043)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seed = await makeVehicle(new InMemoryVehicleRepository(), {}) // both FAR → no candidates
    const fullPage = Array.from(
      { length: SCAN_LIMIT },
      (_, i): Vehicle => ({ ...seed, id: `veh_${i}` }),
    )
    const service = new ComplianceDigestService({
      vehicleRepo: { findAll: async () => ({ data: fullPage, total: SCAN_LIMIT }) },
      alertLogRepo: new InMemoryComplianceAlertLogRepository(),
      resolveRecipients,
      emailSender: fakeSender().sender,
      today: () => TODAY,
      config: { emailFrom: 'fleet@platform.example' },
    })

    const summary = await service.run()
    const warnMsg = warnSpy.mock.calls[0]?.[0] // capture before mockRestore clears it
    warnSpy.mockRestore()

    expect(summary.fleetScanTruncated).toBe(true)
    expect(warnMsg).toContain('page cap') // the cron line names the cause, not just a flag
  })

  it('does not flag fleetScanTruncated for a sub-cap scan', async () => {
    const { vehicleRepo, service } = setup()
    await makeVehicle(vehicleRepo, { shakenExpiryDate: EXPIRED })

    const summary = await service.run()

    expect(summary.fleetScanTruncated).toBe(false)
  })
})
