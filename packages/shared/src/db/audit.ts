import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// #930: durable audit trail for privilege-changing operator/provider events.
// #914 shipped the injected audit *seams* (RecordOperatorProfileAudit /
// RecordProviderInviteAudit) backed only by console.info — ephemeral, unqueryable.
// This is the durable store the seams write to. Kinds are inlined here and the
// union derived from the pgEnum (mirrors notification_kind), so a rename can only
// happen in one place — a hand-mirrored literal would drift then throw 22P02 on insert.
export const auditEventKindEnum = pgEnum('audit_event_kind', [
  'PROVIDER_INVITE_CREATED', // an operator owner / admin invited a staff member (#521)
  'OPERATOR_PROFILE_UPDATED', // owner-tier change to a money-flow field, e.g. preAuthHandoffUrl (#903)
  'OPERATOR_MEMBER_DEACTIVATED', // owner revoked a staff member's access (#904 slice 2)
  'OPERATOR_APPLICATION_APPROVED', // platform admin approved a pending operator application (#1277)
  'OPERATOR_APPLICATION_REJECTED', // platform admin rejected a pending operator application (#1277)
])

// Append-only event ledger. One row per audited action; never updated or deleted.
// Deliberately carries NO foreign keys: an audit trail must survive deletion of the
// operator/user it references (and must never block such a delete), and stays
// decoupled from the entities it observes. Common fields are typed columns (no jsonb)
// because every current kind fits them; add columns when a future kind needs more.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    kind: auditEventKindEnum('kind').notNull(),
    // The user who performed the action (inviter, owner, platform admin).
    actorUserId: text('actorUserId').notNull(),
    // Tenant the event belongs to. Set for every current kind; nullable so a future
    // platform-level event (no single tenant) can be recorded without a schema change.
    operatorId: text('operatorId'),
    // Subject of the action: the invited email, the deactivated member's userId, etc.
    targetId: text('targetId'),
    // Field-level diff for change events (OPERATOR_PROFILE_UPDATED): which field + old/new.
    field: text('field'),
    oldValue: text('oldValue'),
    newValue: text('newValue'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Operator-scoped reads (a tenant's own audit trail) are the expected query.
    index('idx_audit_log_operatorId').on(t.operatorId),
    // Filter a trail by event type (e.g. all deactivations).
    index('idx_audit_log_kind').on(t.kind),
  ],
)

// Derive the kind union from the pgEnum single source (see notification.ts #710).
export type AuditEventKind = (typeof auditEventKindEnum.enumValues)[number]
