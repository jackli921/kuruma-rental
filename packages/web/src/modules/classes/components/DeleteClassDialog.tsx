'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { vehicleKeys } from '@/lib/query-keys'
import { archiveClassAction } from '@/modules/classes/actions'
import type { VehicleClassData } from '@/modules/classes/api'
import { useClassMutation } from '@/modules/classes/hooks'
import type { ClassStats } from '@/modules/classes/stats'
import { hasActiveBookings } from '@/modules/classes/stats'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

interface DeleteClassDialogProps {
  vehicleClass: VehicleClassData | null
  stats: ClassStats | null
  onOpenChange: (open: boolean) => void
}

export function DeleteClassDialog({ vehicleClass, stats, onOpenChange }: DeleteClassDialogProps) {
  const t = useTranslations('business.classes')
  const queryClient = useQueryClient()
  const { mutate, isPending, error } = useClassMutation<string>({
    mutationFn: (id) => archiveClassAction(id),
    onSuccess: () => onOpenChange(false),
  })

  // HIGH 1: Synchronous in-flight guard. React's `isPending` updates between
  // renders, so two clicks in the same frame both see `isPending === false`
  // and fire the archive twice. A ref flips synchronously in onClick.
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    // Mutation finished — reset the lock so the dialog can be retried after
    // an error without a remount.
    inFlightRef.current = false
  }

  // HIGH 2: Refetch fleet-overview every time the dialog opens so the
  // "safe to archive" decision is made against fresh data — a booking may
  // have been confirmed since the Fleet page loaded.
  const isOpen = vehicleClass !== null
  useEffect(() => {
    if (isOpen) {
      queryClient.refetchQueries({ queryKey: vehicleKeys.fleetOverview })
    }
  }, [isOpen, queryClient])

  // Until fleet stats have loaded we cannot confirm the class is
  // booking-free, so disable the destructive action defensively.
  const showBlockedWarning = stats != null && hasActiveBookings(stats)
  const blocked = stats == null || showBlockedWarning

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle', { name: vehicleClass?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
        </DialogHeader>

        {showBlockedWarning && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">
              {t('deleteBlockedActiveBookings', { count: stats.activeBookingsCount })}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={blocked || isPending || vehicleClass == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !vehicleClass) return
              inFlightRef.current = true
              mutate(vehicleClass.id)
            }}
          >
            {isPending ? t('deleting') : t('deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
