'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import type { VehicleData } from '@/lib/vehicle-api'
import { updateVehicle } from '@/lib/vehicle-api'
import type { CreateVehicleInput } from '@kuruma/shared/validators/vehicle'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface EditVehicleDialogProps {
  vehicle: VehicleData | null
  onOpenChange: (open: boolean) => void
}

export function EditVehicleDialog({ vehicle, onOpenChange }: EditVehicleDialogProps) {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (data: CreateVehicleInput) => {
    if (!vehicle) return
    setIsSubmitting(true)
    setError(null)
    try {
      await updateVehicle(vehicle.id, data)
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
          <DialogTitle>{t('editVehicle')}</DialogTitle>
          <DialogDescription>{vehicle?.name}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        {vehicle && (
          <VehicleForm
            key={vehicle.id}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isSubmitting}
            defaultValues={{
              name: vehicle.name,
              description: vehicle.description ?? undefined,
              photos: vehicle.photos,
              seats: vehicle.seats,
              transmission: vehicle.transmission,
              fuelType: vehicle.fuelType ?? undefined,
              bufferMinutes: vehicle.bufferMinutes,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
