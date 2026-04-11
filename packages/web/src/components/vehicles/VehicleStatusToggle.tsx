'use client'

import { cn } from '@/lib/utils'
import { type VehicleData, updateVehicleStatus } from '@/lib/vehicle-api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

interface VehicleStatusToggleProps {
  vehicle: VehicleData
}

type TogglableStatus = 'AVAILABLE' | 'MAINTENANCE'
const togglableStatuses: TogglableStatus[] = ['AVAILABLE', 'MAINTENANCE']
const VEHICLES_KEY = ['vehicles'] as const

interface OptimisticContext {
  previous: VehicleData[] | undefined
}

export function VehicleStatusToggle({ vehicle }: VehicleStatusToggleProps) {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()

  const mutation = useMutation<VehicleData, Error, TogglableStatus, OptimisticContext>({
    mutationFn: (next) => updateVehicleStatus(vehicle.id, next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: VEHICLES_KEY })
      const previous = queryClient.getQueryData<VehicleData[]>(VEHICLES_KEY)
      if (previous) {
        queryClient.setQueryData<VehicleData[]>(
          VEHICLES_KEY,
          previous.map((v) => (v.id === vehicle.id ? { ...v, status: next } : v)),
        )
      }
      return { previous }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(VEHICLES_KEY, ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: VEHICLES_KEY })
    },
  })

  function handleClick(next: TogglableStatus) {
    if (next === vehicle.status) return
    mutation.mutate(next)
  }

  // RETIRED cars surface a single "Restore" affordance instead of the
  // segmented control. Active rental operations (AVAILABLE ↔ MAINTENANCE)
  // are the 95% case and get the fast path; un-retiring is rare and
  // deserves its own obvious control.
  if (vehicle.status === 'RETIRED') {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-0.5">
          <span className="text-xs font-medium text-muted-foreground">{t('status.RETIRED')}</span>
          <button
            type="button"
            onClick={() => mutation.mutate('AVAILABLE')}
            disabled={mutation.isPending}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-60"
          >
            {t('statusToggle.restore')}
          </button>
        </div>
        {mutation.isError && (
          <output className="text-[11px] text-destructive">{t('statusToggle.error')}</output>
        )}
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> would force a <legend> child which doesn't match the inline segmented-control visual. role="group" + aria-label is the standard ARIA authoring pattern for toggle button groups. */}
      <div
        role="group"
        aria-label={t('statusToggle.ariaLabel')}
        className="inline-flex rounded-md border border-border bg-background p-0.5"
      >
        {togglableStatuses.map((status) => {
          const isActive = vehicle.status === status
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleClick(status)}
              disabled={mutation.isPending}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60',
                isActive && status === 'AVAILABLE' && 'bg-emerald-500/15 text-emerald-700',
                isActive && status === 'MAINTENANCE' && 'bg-amber-500/15 text-amber-700',
                !isActive && 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`status.${status}`)}
            </button>
          )
        })}
      </div>
      {mutation.isError && (
        <output className="text-[11px] text-destructive">{t('statusToggle.error')}</output>
      )}
    </div>
  )
}
