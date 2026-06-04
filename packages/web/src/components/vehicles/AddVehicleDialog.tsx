'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { useVehicleMutation } from '@/hooks/useVehicleMutation'
import { createVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleClassData } from '@/modules/classes'
import type { OperatorOption } from '@/modules/operators'
import { useTranslations } from 'next-intl'

interface AddVehicleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes?: readonly VehicleClassData[] | undefined
  operators?: readonly OperatorOption[] | undefined
}

export function AddVehicleDialog({
  open,
  onOpenChange,
  classes,
  operators,
}: AddVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const { mutate, isPending, error, reset } = useVehicleMutation({
    mutationFn: createVehicleAction,
    onSuccess: () => onOpenChange(false),
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addVehicle')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <VehicleForm
          onSubmit={async (data) => mutate(data)}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
          classes={classes}
          operators={operators}
        />
      </DialogContent>
    </Dialog>
  )
}
