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
import { OPERATOR_REQUIRED } from '@/lib/api-error'
import { createVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleClassData } from '@/modules/classes'
import { type OperatorOption, operatorKeys } from '@/modules/operators'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

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
  const queryClient = useQueryClient()
  const { mutate, isPending, error, errorCode, reset } = useVehicleMutation({
    mutationFn: createVehicleAction,
    onSuccess: () => onOpenChange(false),
  })

  // #407 P2 (§3e): a 422 means a second operator now exists and the cached
  // single-operator list is stale. Refetch operators (so the picker lists the
  // new one) and force the picker open with an inline prompt.
  const operatorRequired = errorCode === OPERATOR_REQUIRED
  useEffect(() => {
    if (operatorRequired) queryClient.invalidateQueries({ queryKey: operatorKeys.all })
  }, [operatorRequired, queryClient])

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
        {/* OPERATOR_REQUIRED is surfaced inline by the picker, not here. */}
        {error && !operatorRequired && <p className="text-sm text-destructive px-1">{error}</p>}
        <VehicleForm
          onSubmit={async (data) => mutate(data)}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
          classes={classes}
          operators={operators}
          operatorRequired={operatorRequired}
        />
      </DialogContent>
    </Dialog>
  )
}
