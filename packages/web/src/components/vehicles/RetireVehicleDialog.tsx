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
import type { VehicleData } from '@/lib/vehicle-api'
import { retireVehicle } from '@/lib/vehicle-api'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface RetireVehicleDialogProps {
  vehicle: VehicleData | null
  onOpenChange: (open: boolean) => void
}

export function RetireVehicleDialog({ vehicle, onOpenChange }: RetireVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRetire = async () => {
    if (!vehicle) return
    setIsSubmitting(true)
    setError(null)
    try {
      await retireVehicle(vehicle.id)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('retireConfirm', { name: vehicle?.name })}</DialogTitle>
          <DialogDescription>{t('retireConfirmMessage')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleRetire} disabled={isSubmitting}>
            {t('retireVehicle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
