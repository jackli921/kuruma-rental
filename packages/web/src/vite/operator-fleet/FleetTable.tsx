import { FleetRowActions } from '@/vite/operator-fleet/FleetRowActions'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { ExpiryPill, StatusPill, priceLabel } from '@/vite/operator-fleet/cells'
import { computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { useTranslations } from 'use-intl'

interface FleetTableProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly selectedIds: readonly string[]
  readonly allSelected: boolean
  readonly someSelected: boolean
  readonly onToggleAll: () => void
  readonly onToggleOne: (id: string) => void
  readonly onEdit: (vehicle: OperatorFleetVehicle) => void
  // False for bypass roles: the select + actions columns are dropped so the
  // table is a read-only oversight view (#598).
  readonly canWrite: boolean
  readonly todayIso: string
}

// Row mode for the operator fleet (#561): the original table, extracted from
// OperatorFleetView so the container can swap it for FleetGrid. Purely
// presentational — selection state and the edit handler are injected by the
// parent. Per-row affordances (checkbox + FleetRowActions + onEdit) match the
// grid cards; the header select-all / indeterminate control is row-view only
// (grid per-group select-all is a #561 follow-up).
export function FleetTable({
  vehicles,
  selectedIds,
  allSelected,
  someSelected,
  onToggleAll,
  onToggleOne,
  onEdit,
  canWrite,
  todayIso,
}: FleetTableProps) {
  const t = useTranslations('business.vehicles.fleet')
  const tBulk = useTranslations('business.vehicles.bulk')

  return (
    <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-border border-b bg-muted/40 text-muted-foreground">
          <tr>
            {canWrite && (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  aria-label={tBulk('selectAll')}
                  checked={allSelected}
                  onChange={onToggleAll}
                />
              </th>
            )}
            <th className="px-4 py-3 font-medium">{t('columns.vehicle')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('columns.seats')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('columns.luggage')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('columns.price')}</th>
            <th className="px-4 py-3 font-medium">{t('columns.shaken')}</th>
            {canWrite && (
              <th className="px-4 py-3 text-right font-medium">{t('columns.actions')}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr
              key={v.id}
              className="border-border border-b transition-colors last:border-0 hover:bg-muted/40"
            >
              {canWrite && (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={tBulk('selectRow', { name: v.name })}
                    checked={selectedIds.includes(v.id)}
                    onChange={() => onToggleOne(v.id)}
                  />
                </td>
              )}
              <td className="px-4 py-3">
                <div className="font-medium">{v.name}</div>
                <div className="text-muted-foreground text-xs">
                  <span>{v.licensePlate ?? t('none')}</span>
                  {v.make != null && (
                    <span>{` · ${[v.make, v.model, v.year].filter(Boolean).join(' ')}`}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={v.status} label={t(`status.${v.status}`)} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{v.seats}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {v.luggageCapacity ?? t('none')}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{priceLabel(v, t)}</td>
              <td className="px-4 py-3">
                <ExpiryPill
                  status={computeExpiryStatus(v.shakenExpiryDate, todayIso)}
                  labels={{
                    OK: t('expiry.OK'),
                    EXPIRING_SOON: t('expiry.EXPIRING_SOON'),
                    EXPIRED: t('expiry.EXPIRED'),
                    UNKNOWN: t('expiry.UNKNOWN'),
                  }}
                />
              </td>
              {canWrite && (
                <td className="px-4 py-3 text-right">
                  <FleetRowActions vehicle={v} onEdit={() => onEdit(v)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
