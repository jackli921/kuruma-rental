'use client'

import { Button } from '@/components/ui/button'
import type { VehicleClassData } from '@/modules/classes/api'
import { ClassStatusBadge } from '@/modules/classes/components/ClassStatusBadge'
import type { ClassStats } from '@/modules/classes/stats'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ClassRowProps {
  vehicleClass: VehicleClassData
  stats: ClassStats
  onEdit: (c: VehicleClassData) => void
  onDelete: (c: VehicleClassData) => void
}

function formatYen(value: number | null): string | null {
  if (value == null) return null
  return `¥${value.toLocaleString('en-US')}`
}

export function ClassRow({ vehicleClass: c, stats, onEdit, onDelete }: ClassRowProps) {
  const t = useTranslations('business.classes')
  const daily = formatYen(c.dailyRateJpy)
  const hourly = formatYen(c.hourlyRateJpy)

  return (
    <div className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{c.name}</h3>
          <ClassStatusBadge status={c.status} />
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.slug}</p>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>{t('stats.cars', { count: stats.carsCount })}</span>
          <span>{t('stats.activeBookings', { count: stats.activeBookingsCount })}</span>
          <span>{t('stats.seats', { count: c.seats })}</span>
          <span>{t('stats.luggage', { count: c.luggageCapacity })}</span>
          {daily && <span>{t('stats.daily', { amount: daily })}</span>}
          {hourly && <span>{t('stats.hourly', { amount: hourly })}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => onEdit(c)} aria-label={t('editClass')}>
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(c)}
          aria-label={t('deleteAction')}
          disabled={c.status === 'ARCHIVED'}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}
