import { describe, expect, it } from 'vitest'
import { buildComplianceDigestService } from '../index'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryComplianceAlertLogRepository } from '../repositories/in-memory/compliance-alert-log'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryUserRepository } from '../repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import { complianceAlertKey } from '../repositories/types'
import type { OperatorMembership, User } from '../stores'
import type { EmailMessage } from './email/email-sender'

// Proves the composition seam (#916 §5.4 Slice 2d): buildComplianceDigestService
// wires the fleet scan, the idempotency ledger, the active-member recipient
// resolver, the JST clock, and the email sender into one runnable service. The
// service algorithm itself is unit-tested in compliance-digest.test.ts; this
// asserts the WIRING — the right repo reaches the right slot.
describe('buildComplianceDigestService (composition seam)', () => {
  it('runs the digest end-to-end against injected in-memory repos', async () => {
    const now = new Date()
    const owner: User = {
      id: 'u_owner',
      name: 'Owner',
      email: 'owner@op.example',
      phone: null,
      language: 'ja',
      country: null,
      role: 'OPERATOR_OWNER',
      operatorId: 'op_seed',
    }
    const membership: OperatorMembership = {
      id: 'm_owner',
      userId: 'u_owner',
      operatorId: 'op_seed',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    }

    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const complianceAlertLogRepo = new InMemoryComplianceAlertLogRepository()
    const sent: EmailMessage[] = []
    const emailSender = {
      async send(message: EmailMessage) {
        sent.push(message)
        return { providerMessageId: `msg_${sent.length}` }
      },
    }

    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: 'op_seed',
      classId: 'class_compact',
      pickupLocationId: null,
      name: 'Seed Wagon',
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
      shakenExpiryDate: '2000-01-01', // long expired regardless of the real clock
      insuranceExpiryDate: '2099-01-01', // far future → no band
    })

    const service = buildComplianceDigestService({
      vehicleRepo,
      bookingRepo,
      availabilityRepo: new InMemoryAvailabilityRepository(
        vehicleRepo,
        bookingRepo,
        new InMemoryVehicleBlockRepository(),
        new InMemoryOperatorRepository(),
      ),
      userRepo: new InMemoryUserRepository(new Map([[owner.id, owner]])),
      operatorMembershipRepo: new InMemoryOperatorMembershipRepository(
        new Map([[membership.id, membership]]),
      ),
      complianceAlertLogRepo,
      emailSender,
    })

    const summary = await service.run()

    expect(summary).toMatchObject({ operatorsNotified: 1, alertsRecorded: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.bcc).toEqual(['owner@op.example'])
    expect(sent[0]!.html).toContain('Seed Wagon')
    expect(sent[0]!.html).toContain('期限切れ') // EXPIRED band, ja default

    const keys = await complianceAlertLogRepo.findAlertedKeys([vehicle.id])
    expect(keys).toContain(complianceAlertKey(vehicle.id, 'SHAKEN', 'EXPIRED'))
  })
})
