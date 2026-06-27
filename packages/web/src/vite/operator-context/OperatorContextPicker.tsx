import { useTranslations } from 'use-intl'
import type { OperatorSummary } from './api'
import { useOperatorContext, useSetOperatorContext } from './operator-context'

interface OperatorContextPickerProps {
  readonly operators: readonly OperatorSummary[]
}

// PLATFORM_ADMIN-only context switcher (mounted by BusinessLayout, which checks
// `canPickOperatorContext`). Selecting an operator sets `?operator=<id>`; selecting
// "All operators" clears it (an explicit `undefined` — see useSetOperatorContext).
// Pure presentation: the clear/retain semantics live in the hook. A native <select>
// keeps it dependency-free and accessible.
export function OperatorContextPicker({ operators }: OperatorContextPickerProps) {
  const t = useTranslations('business.operatorContext')
  const setOperatorContext = useSetOperatorContext()
  const { pickedOperatorId } = useOperatorContext()

  // A controlled <select> whose value matches no <option> silently renders the first
  // option ("All operators") while the URL still scopes to that tenant. When the picked
  // id is not in the loaded list (deleted/renamed operator, or first paint before the
  // query resolves) render a synthetic option so the control never misrepresents scope.
  const hasPicked = pickedOperatorId !== undefined
  const pickedIsKnown = operators.some((op) => op.id === pickedOperatorId)

  return (
    <label className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t('label')}</span>
      <select
        className="rounded-md border border-border bg-background px-2 py-1"
        value={pickedOperatorId ?? ''}
        aria-label={t('label')}
        onChange={(e) => setOperatorContext(e.target.value || undefined)}
      >
        <option value="">{t('all')}</option>
        {hasPicked && !pickedIsKnown ? (
          <option value={pickedOperatorId}>{pickedOperatorId}</option>
        ) : null}
        {operators.map((op) => (
          <option key={op.id} value={op.id}>
            {op.name}
          </option>
        ))}
      </select>
    </label>
  )
}
