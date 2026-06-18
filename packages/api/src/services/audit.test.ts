import { describe, expect, it } from 'vitest'
import { type AuditEvent, toAuditRow } from './audit'

describe('toAuditRow', () => {
  it('maps a PROVIDER_INVITE_CREATED event, routing the invited email to targetId', () => {
    const event: AuditEvent = {
      type: 'PROVIDER_INVITE_CREATED',
      invitedByUserId: 'user-owner',
      operatorId: 'op-1',
      email: 'invitee@example.com',
    }

    expect(toAuditRow(event)).toEqual({
      kind: 'PROVIDER_INVITE_CREATED',
      actorUserId: 'user-owner',
      operatorId: 'op-1',
      targetId: 'invitee@example.com',
      field: null,
      oldValue: null,
      newValue: null,
    })
  })

  it('maps an OPERATOR_PROFILE_UPDATED event, carrying the field-level diff', () => {
    const event: AuditEvent = {
      type: 'OPERATOR_PROFILE_UPDATED',
      operatorId: 'op-2',
      actorUserId: 'user-admin',
      field: 'preAuthHandoffUrl',
      oldValue: null,
      newValue: 'https://handoff.example',
      changedAt: new Date('2026-06-17T00:00:00Z'),
    }

    expect(toAuditRow(event)).toEqual({
      kind: 'OPERATOR_PROFILE_UPDATED',
      actorUserId: 'user-admin',
      operatorId: 'op-2',
      targetId: null,
      field: 'preAuthHandoffUrl',
      oldValue: null,
      newValue: 'https://handoff.example',
    })
  })
})
