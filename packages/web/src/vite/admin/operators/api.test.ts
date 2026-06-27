import { describe, expect, it } from 'vitest'
import {
  createdInviteSchema,
  operatorAdminRowSchema,
  operatorSummarySchema,
  operatorWriteAckSchema,
} from './api'

// The wire contract for the platform-admin operator directory (#1088). The API
// returns Date columns, but `c.json` serialises them to ISO strings, so the
// web seam validates strings — these tests pin that shape so a silent API/web
// drift (renamed/removed field) fails here, not deep in render.
describe('operatorAdminRowSchema', () => {
  const activeRow = {
    id: 'op_1',
    name: 'Kanata Cars',
    slug: 'kanata-cars',
    deactivatedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    fleetCount: 12,
  }

  it('parses an active operator row (null deactivatedAt)', () => {
    expect(operatorAdminRowSchema.parse(activeRow)).toEqual(activeRow)
  })

  it('parses a deactivated operator row (ISO-string deactivatedAt)', () => {
    const row = { ...activeRow, deactivatedAt: '2026-06-20T09:30:00.000Z' }
    expect(operatorAdminRowSchema.parse(row).deactivatedAt).toBe('2026-06-20T09:30:00.000Z')
  })

  it('rejects a row missing fleetCount (drift guard)', () => {
    const { fleetCount: _drop, ...withoutFleet } = activeRow
    expect(operatorAdminRowSchema.safeParse(withoutFleet).success).toBe(false)
  })
})

describe('createdInviteSchema', () => {
  it('parses the one-time invite payload', () => {
    const invite = {
      token: 'tok_abc',
      inviteUrl: 'https://app.example.com/provider/invite/tok_abc',
      expiresAt: '2026-07-01T00:00:00.000Z',
    }
    expect(createdInviteSchema.parse(invite)).toEqual(invite)
  })

  it('rejects an invite missing the plaintext token', () => {
    const { token: _drop, ...withoutToken } = {
      token: 'tok_abc',
      inviteUrl: 'https://app.example.com/provider/invite/tok_abc',
      expiresAt: '2026-07-01T00:00:00.000Z',
    }
    expect(createdInviteSchema.safeParse(withoutToken).success).toBe(false)
  })
})

describe('operatorSummarySchema', () => {
  const summary = {
    operatorId: 'op_1',
    name: 'Kanata Cars',
    vehicleCount: 12,
    vehiclesNeedingDocs: 2,
    vehiclesExpiringSoon: 1,
    totalBookings: 40,
    upcomingBookings: 5,
    lastComplianceAlertAt: '2026-06-20T09:30:00.000Z',
  }

  it('parses a summary with an ISO-string lastComplianceAlertAt', () => {
    expect(operatorSummarySchema.parse(summary)).toEqual(summary)
  })

  it('parses a never-alerted summary (null lastComplianceAlertAt)', () => {
    const row = { ...summary, lastComplianceAlertAt: null }
    expect(operatorSummarySchema.parse(row).lastComplianceAlertAt).toBeNull()
  })

  it('rejects a summary missing vehiclesNeedingDocs (drift guard)', () => {
    const { vehiclesNeedingDocs: _drop, ...withoutField } = summary
    expect(operatorSummarySchema.safeParse(withoutField).success).toBe(false)
  })
})

describe('operatorWriteAckSchema', () => {
  it('keeps the identity fields shared by every write projection and strips the rest', () => {
    const richResponse = {
      id: 'op_1',
      name: 'Kanata Cars',
      slug: 'kanata-cars',
      deactivatedAt: '2026-06-20T09:30:00.000Z',
      preAuthHandoffUrl: 'https://example.com/handoff',
    }
    expect(operatorWriteAckSchema.parse(richResponse)).toEqual({
      id: 'op_1',
      name: 'Kanata Cars',
      slug: 'kanata-cars',
    })
  })

  it('rejects a write response missing id (seam drift guard)', () => {
    expect(
      operatorWriteAckSchema.safeParse({ name: 'Kanata Cars', slug: 'kanata-cars' }).success,
    ).toBe(false)
  })
})
