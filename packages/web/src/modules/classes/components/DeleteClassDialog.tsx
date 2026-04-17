'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { archiveClassAction } from '@/modules/classes/actions'
import type { VehicleClassData } from '@/modules/classes/api'
import { useClassMutation } from '@/modules/classes/hooks'
import type { ClassStats } from '@/modules/classes/stats'
import { hasActiveBookings } from '@/modules/classes/stats'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface DeleteClassDialogProps {
  vehicleClass: VehicleClassData | null
  stats: ClassStats | null
  onOpenChange: (open: boolean) => void
}

export function DeleteClassDialog({ vehicleClass, stats, onOpenChange }: DeleteClassDialogProps) {
  const t = useTranslations('business.classes')
  const { mutate, isPending, error } = useClassMutation<string>({
    mutationFn: (id) => archiveClassAction(id),
    onSuccess: () => onOpenChange(false),
  })

  const blocked = stats != null && hasActiveBookings(stats)

  return (
    <Dialog open={vehicleClass !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle', { name: vehicleClass?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
        </DialogHeader>

        {blocked && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">
              {t('deleteBlockedActiveBookings', { count: stats?.activeBookingsCount ?? 0 })}
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
              if (vehicleClass) mutate(vehicleClass.id)
            }}
          >
            {isPending ? t('deleting') : t('deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
