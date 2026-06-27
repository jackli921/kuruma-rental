import { Button } from '@/components/ui/button'
import { useTranslations } from 'use-intl'
import { OperatorRow } from './OperatorRow'
import type { OperatorAdminRow } from './api'

interface OperatorsViewProps {
  readonly operators: OperatorAdminRow[]
  readonly locale: string
  /** The operator whose active-toggle is in flight, so only its button disables. */
  readonly togglingId: string | null
  readonly onCreate: () => void
  readonly onEdit: (operator: OperatorAdminRow) => void
  readonly onInvite: (operator: OperatorAdminRow) => void
  readonly onToggleActive: (operator: OperatorAdminRow) => void
}

/**
 * Platform-admin operator directory (#1088, epic #1075 slice 2). Pure function of
 * props (FC/IS — the route owns the query, mutations and dialog state). Lists
 * every operator (active + deactivated) with fleet size and status, and exposes
 * create / invite-staff / rename / deactivate-reactivate entry points.
 */
export function OperatorsView({
  operators,
  locale,
  togglingId,
  onCreate,
  onEdit,
  onInvite,
  onToggleActive,
}: OperatorsViewProps) {
  const t = useTranslations('admin.operators')
  const head = 'px-3 py-2 text-left font-medium text-muted-foreground'
  const headNum = 'px-3 py-2 text-right font-medium text-muted-foreground'

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <Button type="button" onClick={onCreate}>
          {t('create')}
        </Button>
      </div>

      {operators.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-border border-b bg-muted/50">
              <tr>
                <th scope="col" className={head}>
                  {t('colName')}
                </th>
                <th scope="col" className={headNum}>
                  {t('colFleet')}
                </th>
                <th scope="col" className={head}>
                  {t('colStatus')}
                </th>
                <th scope="col" className={head}>
                  {t('colCreated')}
                </th>
                <th scope="col" className={`${head} text-right`}>
                  {t('colActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {operators.map((operator) => (
                <OperatorRow
                  key={operator.id}
                  operator={operator}
                  locale={locale}
                  isToggling={togglingId === operator.id}
                  onEdit={onEdit}
                  onInvite={onInvite}
                  onToggleActive={onToggleActive}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
