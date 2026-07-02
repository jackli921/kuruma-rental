import type { AuditLogEntry } from '../stores'
import type { OperatorProfileAuditEvent } from './operator'
import type {
  OperatorApplicationApprovedAuditEvent,
  OperatorApplicationRejectedAuditEvent,
} from './operator-application'
import type { OperatorMemberDeactivatedAuditEvent } from './operator-team'
import type { ProviderInviteAuditEvent } from './provider-invite'

// #930: the closed set of audited domain events. Each variant is already defined
// at the service that raises it (the seams #914 shipped); this union is the
// single type the durable sink accepts, so adding an audited action = adding a
// member here + a `toAuditRow` case (exhaustive-checked).
export type AuditEvent =
  | ProviderInviteAuditEvent
  | OperatorProfileAuditEvent
  | OperatorMemberDeactivatedAuditEvent
  | OperatorApplicationApprovedAuditEvent
  | OperatorApplicationRejectedAuditEvent

// The injected sink the composition root wires to a fire-and-forget durable
// insert. Wider than the per-service ports (RecordProviderInviteAudit etc.), so
// it stays assignable to each — services keep their narrow port, unchanged.
export type RecordAuditEvent = (event: AuditEvent) => void

type AuditRow = Omit<AuditLogEntry, 'id' | 'createdAt'>

// Pure decision (FC/IS): flatten a domain event onto the typed audit_log columns.
// `type` is the discriminant AND the persisted `kind`. No I/O, no clock — the
// row's createdAt is the DB default; the imperative shell (the sink) does the
// insert. Exhaustive over AuditEvent: a new variant fails to compile until mapped.
export function toAuditRow(event: AuditEvent): AuditRow {
  switch (event.type) {
    case 'PROVIDER_INVITE_CREATED':
      return {
        kind: 'PROVIDER_INVITE_CREATED',
        actorUserId: event.invitedByUserId,
        operatorId: event.operatorId,
        targetId: event.email,
        field: null,
        oldValue: null,
        newValue: null,
      }
    case 'OPERATOR_PROFILE_UPDATED':
      return {
        kind: 'OPERATOR_PROFILE_UPDATED',
        actorUserId: event.actorUserId,
        operatorId: event.operatorId,
        targetId: null,
        field: event.field,
        oldValue: event.oldValue,
        newValue: event.newValue,
      }
    case 'OPERATOR_MEMBER_DEACTIVATED':
      return {
        kind: 'OPERATOR_MEMBER_DEACTIVATED',
        actorUserId: event.actorUserId,
        operatorId: event.operatorId,
        targetId: event.targetUserId,
        field: null,
        oldValue: null,
        newValue: null,
      }
    case 'OPERATOR_APPLICATION_APPROVED':
      return {
        kind: 'OPERATOR_APPLICATION_APPROVED',
        actorUserId: event.actorUserId,
        operatorId: event.operatorId,
        targetId: event.applicationId,
        field: null,
        oldValue: null,
        newValue: null,
      }
    case 'OPERATOR_APPLICATION_REJECTED':
      return {
        kind: 'OPERATOR_APPLICATION_REJECTED',
        actorUserId: event.actorUserId,
        operatorId: null,
        targetId: event.applicationId,
        field: null,
        oldValue: null,
        newValue: null,
      }
  }
}
