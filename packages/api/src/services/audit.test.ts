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

  it('maps an OPERATOR_MEMBER_DEACTIVATED event, routing the revoked member to targetId', () => {
    const event: AuditEvent = {
      type: 'OPERATOR_MEMBER_DEACTIVATED',
      operatorId: 'op-3',
      actorUserId: 'user-owner',
      targetUserId: 'user-staff',
    }

    expect(toAuditRow(event)).toEqual({
      kind: 'OPERATOR_MEMBER_DEACTIVATED',
      actorUserId: 'user-owner',
      operatorId: 'op-3',
      targetId: 'user-staff',
      field: null,
      oldValue: null,
      newValue: null,
    })
  })

  it('maps an OPERATOR_APPLICATION_APPROVED event, setting operatorId and routing applicationId to targetId', () => {
    const event: AuditEvent = {
      type: 'OPERATOR_APPLICATION_APPROVED',
      actorUserId: 'admin-1',
      operatorId: 'op-new',
      applicationId: 'app-42',
    }

    expect(toAuditRow(event)).toEqual({
      kind: 'OPERATOR_APPLICATION_APPROVED',
      actorUserId: 'admin-1',
      operatorId: 'op-new',
      targetId: 'app-42',
      field: null,
      oldValue: null,
      newValue: null,
    })
  })

  it('maps an OPERATOR_APPLICATION_REJECTED event, leaving operatorId null and routing applicationId to targetId', () => {
    const event: AuditEvent = {
      type: 'OPERATOR_APPLICATION_REJECTED',
      actorUserId: 'a',
      applicationId: 'x',
    }

    expect(toAuditRow(event)).toEqual({
      kind: 'OPERATOR_APPLICATION_REJECTED',
      actorUserId: 'a',
      operatorId: null,
      targetId: 'x',
      field: null,
      oldValue: null,
      newValue: null,
    })
  })
})
