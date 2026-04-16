'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useVehicleMutation } from '@/hooks/useVehicleMutation'
import { retireVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
import { useTranslations } from 'next-intl'

interface RetireVehicleDialogProps {
  vehicle: VehicleData | null
  onOpenChange: (open: boolean) => void
}

export function RetireVehicleDialog({ vehicle, onOpenChange }: RetireVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const { mutate, isPending, error } = useVehicleMutation<void>({
    mutationFn: () => retireVehicleAction(vehicle?.id ?? ''),
    onSuccess: () => onOpenChange(false),
  })

  return (
    <Dialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('retireConfirm', { name: vehicle?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('retireConfirmMessage')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => mutate()} disabled={isPending}>
            {t('retireVehicle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
