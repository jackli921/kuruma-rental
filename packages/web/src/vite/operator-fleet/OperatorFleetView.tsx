import { formatVehicleRate } from '@/lib/format'
import { BulkActionBar } from '@/vite/operator-fleet/BulkActionBar'
import type { OperatorFleetVehicle, VehicleStatus } from '@/vite/operator-fleet/api'
import { type ExpiryStatus, computeExpiryStatus } from '@kuruma/shared/lib/expiry'
import { CarFront } from 'lucide-react'
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

  const clearSelection = () => setSelectedIds([])
  const allSelected = vehicles.length > 0 && selectedIds.length === vehicles.length
  const toggleAll = () => setSelectedIds(allSelected ? [] : vehicles.map((v) => v.id))
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  if (vehicles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border py-20">
        <CarFront className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
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
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BulkActionBar
        selectedIds={[...selectedIds]}
        onDone={clearSelection}
        onClear={clearSelection}
      />
    </>
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
