import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { OperatorAdminRow } from './api'

interface OperatorRowProps {
  readonly operator: OperatorAdminRow
  readonly locale: string
  readonly isToggling: boolean
  readonly onEdit: (operator: OperatorAdminRow) => void
  readonly onInvite: (operator: OperatorAdminRow) => void
  readonly onToggleActive: (operator: OperatorAdminRow) => void
}

const cell = 'px-3 py-2.5 align-middle'

const ACTIVE_PILL =
  'inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-600 text-xs dark:text-emerald-400'
const INACTIVE_PILL =
  'inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 font-medium text-destructive text-xs'

/**
 * One operator row in the platform-admin directory (#1088). Pure function of
 * props (FC/IS — the route owns the toggle mutation; this just renders status +
 * fires callbacks). `active` is derived from `deactivatedAt === null`: an active
 * operator offers Deactivate (destructive), a deactivated one offers Reactivate.
 */
export function OperatorRow({
  operator,
  locale,
  isToggling,
  onEdit,
  onInvite,
  onToggleActive,
}: OperatorRowProps) {
  const t = useTranslations('admin.operators')
  const isActive = operator.deactivatedAt === null

  const toggleLabel = isActive
    ? isToggling
      ? t('row.deactivating')
      : t('row.deactivate')
    : isToggling
      ? t('row.reactivating')
      : t('row.reactivate')

  return (
    <tr className="border-border border-b last:border-0">
      <td className={cell}>
        <div className="font-medium">{operator.name}</div>
        <div className="text-muted-foreground text-xs">{operator.slug}</div>
      </td>
      <td className={`${cell} text-right tabular-nums`}>{operator.fleetCount}</td>
      <td className={cell}>
        <span className={isActive ? ACTIVE_PILL : INACTIVE_PILL}>
          {isActive ? t('status.active') : t('status.deactivated')}
        </span>
      </td>
      <td className={`${cell} text-muted-foreground`}>
        {formatDateTime(operator.createdAt, locale)}
      </td>
      <td className={cell}>
        <div className="flex justify-end gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => onInvite(operator)}>
            {t('row.invite')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(operator)}>
            {t('row.edit')}
          </Button>
          <Button
            type="button"
            variant={isActive ? 'destructive' : 'outline'}
            size="sm"
            disabled={isToggling}
            onClick={() => onToggleActive(operator)}
          >
            {toggleLabel}
          </Button>
        </div>
      </td>
    </tr>
  )
}
