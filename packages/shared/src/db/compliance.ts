import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { ComplianceAlertBand, ComplianceDocumentType } from '../lib/compliance'
import { operators } from './auth'
import { vehicles } from './fleet'

// §5.4/§6/§7 (#916): the compliance-digest idempotency ledger. The booking-centric
// notification_log is keyed by bookingId; a fleet-compliance alert is vehicle/
// operator-coupled with no booking, so it lives in its own ledger (Bounded
// Context — §6). Append-only: one row is written per (vehicle, document, band)
// the day that band is FIRST crossed, sealing it so subsequent daily runs never
// re-send the same reminder.
export const complianceAlertLog = pgTable(
  'compliance_alert_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Denormalised tenant owner so the Slice-3 operator feed scopes without a join.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    // CASCADE: an alert is meaningless once the vehicle is gone (operational, not
    // a legal audit) — and it keeps fixture cleanup a single vehicle delete.
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    // SHAKEN | INSURANCE — typed off the shared lib union, the single source.
    documentType: text('documentType').$type<ComplianceDocumentType>().notNull(),
    // MISSING | EXPIRED | D30 | D14 | D7 | D1 — the band that fired this alert.
    thresholdBand: text('thresholdBand').$type<ComplianceAlertBand>().notNull(),
    recipient: text('recipient').notNull(), // active-member addresses joined at send time
    sentAt: timestamp('sentAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_compliance_alert_log_operatorId').on(t.operatorId),
    // Covers the vehicleId FK (lint:fk-indexes; the composite unique below leads
    // with vehicleId but the gate credits only declared indexes / PKs).
    index('idx_compliance_alert_log_vehicleId').on(t.vehicleId),
    // Idempotency seal: one alert per (vehicle, document, band) across daily runs.
    // operatorId is deliberately NOT part of the seal — safe ONLY because a vehicle
    // can never change operator (the tenant anchor is stripped on update; see
    // repositories/drizzle/vehicle.ts `update`). If vehicle→operator reassignment is
    // ever added, this seal must widen to include operatorId, or onConflictDoNothing
    // will silently suppress the new operator's first alert for any band the old one
    // already consumed (#1043).
    unique('compliance_alert_log_band_unique').on(t.vehicleId, t.documentType, t.thresholdBand),
  ],
)
