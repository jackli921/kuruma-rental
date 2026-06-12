import { Button } from '@/components/ui/button'
import { type FleetFilterState, filterVehicles } from '@/lib/fleet-filters'
import { formatVehicleRate } from '@/lib/format'
import { BulkActionBar } from '@/vite/operator-fleet/BulkActionBar'
import { EditVehicleSheet } from '@/vite/operator-fleet/EditVehicleSheet'
import { FleetFilters } from '@/vite/operator-fleet/FleetFilters'
import { FleetRowActions } from '@/vite/operator-fleet/FleetRowActions'
import type { OperatorFleetVehicle, VehicleStatus } from '@/vite/operator-fleet/api'
import { type ExpiryStatus, computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { CarFront, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface OperatorFleetViewProps {
  readonly vehicles: readonly OperatorFleetVehicle[]
  readonly locale: string
}

// Stateful fleet management container. The route owns the loader /
// useSuspenseQuery and the pending/error boundaries; this owns the interaction
// state (selection, filters, the edit sheet) and mounts the controlled CRUD /
// bulk / photo / filter slices (#526). Decision logic stays in the pure
// fleet-filters lib (FC/IS); this is the imperative shell that holds UI state.
export function OperatorFleetView({ vehicles, locale: _locale }: OperatorFleetViewProps) {
  const t = useTranslations('business.vehicles.fleet')
  const tBulk = useTranslations('business.vehicles.bulk')
  const todayIso = new Date().toISOString().slice(0, 10)
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [filters, setFilters] = useState<FleetFilterState>({})
  const [sheet, setSheet] = useState<{ vehicle: OperatorFleetVehicle | null } | null>(null)

  const visibleVehicles = filterVehicles([...vehicles], filters)
  const visibleIds = visibleVehicles.map((v) => v.id)
  const clearSelection = () => setSelectedIds([])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const toggleAll = () => setSelectedIds(allSelected ? [] : visibleIds)
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setSheet({ vehicle: null })}>
          <Plus className="size-4" />
          {t('addVehicle')}
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
          <CarFront className="mb-4 size-12 text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="lg:w-64 lg:shrink-0">
            <FleetFilters vehicles={vehicles} value={filters} onChange={setFilters} />
          </aside>
          <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={tBulk('selectAll')}
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">{t('columns.vehicle')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('columns.seats')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('columns.luggage')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('columns.price')}</th>
                  <th className="px-4 py-3 font-medium">{t('columns.shaken')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleVehicles.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={tBulk('selectRow', { name: v.name })}
                        checked={selectedIds.includes(v.id)}
                        onChange={() => toggleOne(v.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
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
                    <td className="px-4 py-3 text-right">
                      <FleetRowActions vehicle={v} onEdit={() => setSheet({ vehicle: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BulkActionBar
        selectedIds={[...selectedIds]}
        onDone={clearSelection}
        onClear={clearSelection}
      />
      <EditVehicleSheet
        open={sheet !== null}
        vehicle={sheet?.vehicle ?? null}
        onOpenChange={(next) => {
          if (!next) setSheet(null)
        }}
        onSaved={() => setSheet(null)}
      />
    </div>
  )
}

function priceLabel(v: OperatorFleetVehicle, t: (k: string) => string) {
  return (
    formatVehicleRate(v.dailyRateJpy, v.hourlyRateJpy, {
      perDay: t('perDay'),
      perHour: t('perHour'),
    }) ?? t('none')
  )
}

const STATUS_PILL: Record<VehicleStatus, string> = {
  AVAILABLE: 'border-transparent bg-muted text-foreground',
  MAINTENANCE: 'border-amber-300 text-amber-700 dark:text-amber-400',
  RETIRED: 'border-transparent bg-muted text-muted-foreground',
}

function StatusPill({ status, label }: { status: VehicleStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status]}`}
    >
      {label}
    </span>
  )
}

const EXPIRY_PILL: Record<ExpiryStatus, string> = {
  OK: 'text-muted-foreground',
  EXPIRING_SOON: 'text-amber-700 dark:text-amber-400',
  EXPIRED: 'text-destructive font-medium',
  UNKNOWN: 'text-muted-foreground',
}

function ExpiryPill({
  status,
  labels,
}: {
  status: ExpiryStatus
  labels: Record<ExpiryStatus, string>
}) {
  return <span className={`text-xs ${EXPIRY_PILL[status]}`}>{labels[status]}</span>
}
