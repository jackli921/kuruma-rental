import {
  type ComplianceAlertBand,
  type ComplianceDocumentType,
  vehicleAlertCandidates,
} from '@kuruma/shared/lib/compliance'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import {
  type ComplianceAlertLogRepository,
  type VehicleRepository,
  complianceAlertKey,
} from '../repositories/types'
import type { EmailMessage, EmailSender } from './email/email-sender'
import { renderComplianceDigest } from './email/templates/compliance-digest'
import type { ResolveOperatorRecipientsBatch } from './operator-recipients'

// Operators are Japan/JST; the digest is operator-facing (§12.2 working language).
const DEFAULT_DIGEST_LOCALE = 'ja'
// One scan of the whole fleet (40-50 today, low hundreds at scale) — a single
// bounded page, not paginated: the digest must see every vehicle in one pass.
const SCAN_LIMIT = 2000

export interface ComplianceDigestConfig {
  emailFrom: string
  emailReplyTo?: string | undefined
  locale?: string | undefined
}

export interface ComplianceDigestDeps {
  vehicleRepo: Pick<VehicleRepository, 'findAll'>
  alertLogRepo: ComplianceAlertLogRepository
  resolveRecipients: ResolveOperatorRecipientsBatch
  emailSender: EmailSender
  /** JST calendar day (YYYY-MM-DD) the bands are computed against — the one clock. */
  today: () => string
  config: ComplianceDigestConfig
}

/** Observability counters for the cron log line — one run's outcome at a glance. */
export interface ComplianceDigestSummary {
  operatorsNotified: number
  alertsRecorded: number
  operatorsSkippedNoRecipients: number
  operatorsFailed: number
}

interface AlertCandidate {
  operatorId: string
  vehicleId: string
  vehicleName: string
  licensePlate: string | null
  documentType: ComplianceDocumentType
  band: ComplianceAlertBand
}

/**
 * Daily fleet-compliance digest (#916 §5.4). Scans every non-retired vehicle,
 * maps each shaken/insurance date to its alert band (pure core), drops bands
 * already sent (the idempotency ledger), groups the new ones by operator, and
 * sends one Bcc mail per operator — recording each band AFTER a successful send
 * so a provider failure retries next run rather than sealing an unsent alert.
 */
export class ComplianceDigestService {
  constructor(private readonly deps: ComplianceDigestDeps) {}

  async run(): Promise<ComplianceDigestSummary> {
    const today = this.deps.today()
    const { data: vehicles } = await this.deps.vehicleRepo.findAll(SYSTEM_CONTEXT, {
      limit: SCAN_LIMIT,
    })

    const candidates = vehicles.flatMap((v) =>
      vehicleAlertCandidates(v, today).map(
        ({ documentType, band }): AlertCandidate => ({
          operatorId: v.operatorId,
          vehicleId: v.id,
          vehicleName: v.name,
          licensePlate: v.licensePlate,
          documentType,
          band,
        }),
      ),
    )
    if (candidates.length === 0) return EMPTY_SUMMARY

    const alerted = await this.deps.alertLogRepo.findAlertedKeys(candidates.map((c) => c.vehicleId))
    const fresh = candidates.filter(
      (c) => !alerted.has(complianceAlertKey(c.vehicleId, c.documentType, c.band)),
    )

    let operatorsNotified = 0
    let alertsRecorded = 0
    let operatorsSkippedNoRecipients = 0
    let operatorsFailed = 0

    // Group fresh alerts by operator in one pass (mirrors groupByLocation in
    // storefront-search) instead of re-scanning `fresh` once per operator.
    const itemsByOperator = new Map<string, AlertCandidate[]>()
    for (const c of fresh) {
      const list = itemsByOperator.get(c.operatorId) ?? []
      itemsByOperator.set(c.operatorId, [...list, c])
    }

    // #1010: resolve every operator's recipients up front in a constant number of
    // queries (one membership read + one user read), then loop to send — no
    // per-operator round-trip inside the loop.
    const recipientsByOperator = await this.deps.resolveRecipients([...itemsByOperator.keys()])
    for (const [operatorId, items] of itemsByOperator) {
      const recipients = recipientsByOperator.get(operatorId) ?? []
      // No recipients → don't send and don't record, so the alert retries once a
      // member exists (record-after-send applies to the empty-audience case too).
      if (recipients.length === 0) {
        operatorsSkippedNoRecipients++
        continue
      }

      try {
        await this.deps.emailSender.send(this.buildMessage(items, recipients))
      } catch (err) {
        // Send failed → leave the bands unrecorded so tomorrow's run retries.
        // Log the operator + cause so a chronically-failing recipient is visible
        // in the cron output, not silently masked by the daily retry.
        console.error('[cron:compliance-digest] send failed', { operatorId, err })
        operatorsFailed++
        continue
      }

      operatorsNotified++
      const recipientAudit = recipients.join(',')
      for (const c of items) {
        await this.deps.alertLogRepo.record({
          operatorId,
          vehicleId: c.vehicleId,
          documentType: c.documentType,
          thresholdBand: c.band,
          recipient: recipientAudit,
        })
        alertsRecorded++
      }
    }

    return { operatorsNotified, alertsRecorded, operatorsSkippedNoRecipients, operatorsFailed }
  }

  private buildMessage(items: AlertCandidate[], recipients: string[]): EmailMessage {
    const locale = this.deps.config.locale ?? DEFAULT_DIGEST_LOCALE
    const rendered = renderComplianceDigest(
      {
        items: items.map((c) => ({
          vehicle: { name: c.vehicleName, licensePlate: c.licensePlate },
          documentType: c.documentType,
          band: c.band,
        })),
      },
      locale,
    )
    const { emailFrom, emailReplyTo } = this.deps.config
    return {
      // Send-to-self envelope with members in Bcc (#878) — teammates' addresses
      // never disclose to each other, and one send covers the whole operator.
      to: emailFrom,
      bcc: recipients,
      from: emailFrom,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(emailReplyTo ? { replyTo: emailReplyTo } : {}),
    }
  }
}

const EMPTY_SUMMARY: ComplianceDigestSummary = {
  operatorsNotified: 0,
  alertsRecorded: 0,
  operatorsSkippedNoRecipients: 0,
  operatorsFailed: 0,
}
