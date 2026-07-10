import type { ConsentDocStatus } from '@kuruma/shared/enums'
import { computeContentHash } from '@kuruma/shared/lib/consent-canonical'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import { CONSENT_DOC_OPERATOR_TVL_CONSTRAINT, pgConstraintName } from '../pg-errors'
import type { ConsentRepository, NewConsentDocument } from '../repositories/types-consent'
import type { ConsentDocument } from '../stores'

const TYPE = 'OPERATOR_RENTAL_TERMS' as const
const LOCALES = ['en', 'ja', 'zh'] as const

export interface OperatorTermsVersion {
  version: string
  status: ConsentDocStatus
  effectiveFrom: Date
  publishedAt: Date | null
  locales: string[]
  title: string // en row (the always-present canonical locale)
  body: string
  acceptanceLabel: string
}

export type OperatorTermsResult =
  | { ok: true; version: OperatorTermsVersion }
  | { ok: false; error: string; status: number }
export type OperatorTermsListResult =
  | { ok: true; versions: OperatorTermsVersion[] }
  | { ok: false; error: string; status: number }

function versionNumber(v: string): number {
  const n = Number(v.replace(/^v/, ''))
  return Number.isFinite(n) ? n : 0
}

/** Group per-locale rows of one version into a display object (en is the canonical row). */
function toVersion(rows: ConsentDocument[]): OperatorTermsVersion {
  const en = rows.find((r) => r.locale === 'en') ?? rows[0]!
  return {
    version: en.version,
    status: en.status,
    effectiveFrom: en.effectiveFrom,
    publishedAt: en.publishedAt,
    locales: rows.map((r) => r.locale).sort(),
    title: en.title,
    body: en.body,
    acceptanceLabel: en.acceptanceLabel,
  }
}

export class OperatorTermsService {
  constructor(private readonly repo: ConsentRepository) {}

  async list(operatorId: string): Promise<OperatorTermsListResult> {
    const rows = await this.repo.findOperatorDocuments(operatorId, TYPE)
    const byVersion = new Map<string, ConsentDocument[]>()
    for (const r of rows) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r])
    const versions = [...byVersion.values()]
      .map(toVersion)
      .sort((a, b) => versionNumber(b.version) - versionNumber(a.version))
    return { ok: true, versions }
  }

  async saveDraft(
    operatorId: string,
    input: SaveOperatorTermsDraftInput,
    now: Date,
  ): Promise<OperatorTermsResult> {
    const existing = await this.repo.findOperatorDocuments(operatorId, TYPE)
    const draftVersion = existing.find((d) => d.status === 'DRAFT')?.version
    const version = draftVersion ?? this.nextVersion(existing)
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now

    const rows: NewConsentDocument[] = LOCALES.flatMap((locale) => {
      const t = input[locale]
      if (!t) return []
      return [
        {
          operatorId,
          type: TYPE,
          version,
          locale,
          title: t.title,
          body: t.body,
          acceptanceLabel: t.acceptanceLabel,
          contentHash: computeContentHash(t),
          status: 'DRAFT' as const,
          effectiveFrom,
          publishedAt: null,
        },
      ]
    })

    try {
      // Atomic delete-old-draft + insert (#1498) — the repo runs both in one tx.
      const created = await this.repo.replaceOperatorDraftRows(operatorId, TYPE, version, rows)
      return { ok: true, version: toVersion(created) }
    } catch (err) {
      // Two concurrent first-saves compute the same nextVersion; the loser trips
      // consent_documents_operator_tvl_unique. Surface a clean 409, not a raw 500.
      if (pgConstraintName(err) === CONSENT_DOC_OPERATOR_TVL_CONSTRAINT)
        return { ok: false, error: 'A draft for this version already exists', status: 409 }
      throw err
    }
  }

  async publish(operatorId: string, version: string, now: Date): Promise<OperatorTermsResult> {
    const rows = await this.repo.setOperatorVersionStatus({
      operatorId,
      type: TYPE,
      version,
      from: 'DRAFT',
      to: 'PUBLISHED',
      publishedAt: now,
      now,
    })
    if (rows.length === 0)
      return { ok: false, error: 'No draft to publish for that version', status: 404 }
    return { ok: true, version: toVersion(rows) }
  }

  async archive(operatorId: string, version: string, now: Date): Promise<OperatorTermsResult> {
    const rows = await this.repo.setOperatorVersionStatus({
      operatorId,
      type: TYPE,
      version,
      from: 'PUBLISHED',
      to: 'ARCHIVED',
      publishedAt: null,
      now,
    })
    if (rows.length === 0)
      return { ok: false, error: 'No published version to archive', status: 404 }
    return { ok: true, version: toVersion(rows) }
  }

  private nextVersion(existing: ConsentDocument[]): string {
    const max = existing.reduce((m, d) => Math.max(m, versionNumber(d.version)), 0)
    return `v${max + 1}`
  }
}
