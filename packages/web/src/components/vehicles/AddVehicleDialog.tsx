'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { createVehicle } from '@/lib/vehicle-api'
import type { CreateVehicleInput } from '@kuruma/shared/validators/vehicle'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface AddVehicleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddVehicleDialog({ open, onOpenChange }: AddVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (data: CreateVehicleInput) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await createVehicle(data)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addVehicle')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <VehicleForm
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          isSubmitting={isSubmitting}
        />
      </DialogContent>
    </Dialog>
  )
}
