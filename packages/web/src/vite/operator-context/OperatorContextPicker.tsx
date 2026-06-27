import { useTranslations } from 'use-intl'
import type { OperatorSummary } from './api'
import { useOperatorContext, useOperatorContextNavigate } from './operator-context'

interface OperatorContextPickerProps {
  readonly operators: readonly OperatorSummary[]
}

// PLATFORM_ADMIN-only context switcher (mounted by BusinessLayout, which checks
// `canPickOperatorContext`). Selecting an operator sets `?operator=<id>`; selecting
// "All operators" navigates with `operator: undefined` (an explicit clear — omitting
// the key would be retained by retainSearchParams). A native <select> keeps it
// dependency-free and accessible.
export function OperatorContextPicker({ operators }: OperatorContextPickerProps) {
  const t = useTranslations('business.operatorContext')
  const navigate = useOperatorContextNavigate()
  const { pickedOperatorId } = useOperatorContext()

  return (
    <label className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t('label')}</span>
      <select
        className="rounded-md border border-border bg-background px-2 py-1"
        value={pickedOperatorId ?? ''}
        aria-label={t('label')}
        onChange={(e) => {
          const next = e.target.value || undefined
          navigate({ search: (prev) => ({ ...prev, operator: next }) })
        }}
      >
        <option value="">{t('all')}</option>
        {operators.map((op) => (
          <option key={op.id} value={op.id}>
            {op.name}
          </option>
        ))}
      </select>
    </label>
  )
}
