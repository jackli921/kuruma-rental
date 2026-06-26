import { NativeSelect } from '@/components/ui/native-select'
import { formatDateTime } from '@/lib/format'
import { CONSENT_TYPES, type ConsentType } from '@kuruma/shared/enums'
import type {
  ConsentAcceptanceListItem,
  ConsentGovernanceFilters,
} from '@kuruma/shared/types/consent-governance'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { consentEvidenceUrl } from './api'

// Narrow the native-select value to the enum instead of asserting: the empty
// "all types" option and any drift map to `undefined` (no filter) rather than a
// lying cast. The server re-validates against the same enum and 400s on drift.
const isConsentType = (value: string): value is ConsentType =>
  (CONSENT_TYPES as readonly string[]).includes(value)

interface ConsentGovernanceViewProps {
  readonly acceptances: ConsentAcceptanceListItem[]
  readonly filters: ConsentGovernanceFilters
  /** Apply a new filter set — the route turns this into a URL navigation. */
  readonly onApplyFilters: (filters: ConsentGovernanceFilters) => void
}

// Presentational platform-admin consent-acceptance ledger (#1091). Pure function of
// props (FC/IS — the route owns the loader / useSuspenseQuery and turns the filter
// callback into a URL nav); this only renders the filter bar + table and links each
// row to the existing evidence export. Read-only: no status, no re-consent action.
export function ConsentGovernanceView({
  acceptances,
  filters,
  onApplyFilters,
}: ConsentGovernanceViewProps) {
  const t = useTranslations('admin.governance')
  const locale = useLocale()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <FilterBar filters={filters} onApply={onApplyFilters} />

      {acceptances.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t('colUser')}</th>
                <th className="px-4 py-3 font-medium">{t('colType')}</th>
                <th className="px-4 py-3 font-medium">{t('colVersion')}</th>
                <th className="px-4 py-3 font-medium">{t('colAccepted')}</th>
                <th className="px-4 py-3 font-medium">{t('colEvidence')}</th>
              </tr>
            </thead>
            <tbody>
              {acceptances.map((row) => (
                <tr key={row.acceptanceId} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs">{row.userId}</td>
                  <td className="px-4 py-3">{row.consentType}</td>
                  <td className="px-4 py-3 tabular-nums">{row.version}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {formatDateTime(row.acceptedAt, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={consentEvidenceUrl(row.acceptanceId)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                      aria-label={t('evidenceLinkLabel', { user: row.userId })}
                    >
                      {t('viewEvidence')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface FilterBarProps {
  readonly filters: ConsentGovernanceFilters
  readonly onApply: (filters: ConsentGovernanceFilters) => void
}

// Local draft state so typing doesn't navigate on every keystroke; the form
// commits on submit. The consentType select commits immediately (a small,
// closed domain) for a snappier narrow.
function FilterBar({ filters, onApply }: FilterBarProps) {
  const t = useTranslations('admin.governance')
  const [userId, setUserId] = useState(filters.userId ?? '')
  const [version, setVersion] = useState(filters.version ?? '')

  function apply(next: ConsentGovernanceFilters) {
    onApply(stripEmpty(next))
  }

  return (
    <form
      className="mt-5 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        apply({ ...filters, userId, version })
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="consent-type" className="text-xs text-muted-foreground">
          {t('filterType')}
        </label>
        <NativeSelect
          id="consent-type"
          className="w-48"
          value={filters.consentType ?? ''}
          onChange={(e) =>
            apply({
              ...filters,
              consentType: isConsentType(e.target.value) ? e.target.value : undefined,
            })
          }
        >
          <option value="">{t('allTypes')}</option>
          {CONSENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="consent-user" className="text-xs text-muted-foreground">
          {t('filterUser')}
        </label>
        <input
          id="consent-user"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="h-9 w-56 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="consent-version" className="text-xs text-muted-foreground">
          {t('filterVersion')}
        </label>
        <input
          id="consent-version"
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm"
        />
      </div>

      <button
        type="submit"
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('apply')}
      </button>
      <button
        type="button"
        onClick={() => {
          setUserId('')
          setVersion('')
          onApply({})
        }}
        className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted/50"
      >
        {t('clear')}
      </button>
    </form>
  )
}

/** Drop blank string fields so an empty control doesn't send `?userId=` to the API. */
function stripEmpty(filters: ConsentGovernanceFilters): ConsentGovernanceFilters {
  const next: ConsentGovernanceFilters = {}
  if (filters.userId) next.userId = filters.userId
  if (filters.consentType) next.consentType = filters.consentType
  if (filters.version) next.version = filters.version
  if (filters.acceptedFrom) next.acceptedFrom = filters.acceptedFrom
  if (filters.acceptedTo) next.acceptedTo = filters.acceptedTo
  return next
}
