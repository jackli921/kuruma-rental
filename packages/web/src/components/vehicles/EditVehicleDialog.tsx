'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PhotoUpload } from '@/components/vehicles/PhotoUpload'
import { VehicleForm } from '@/components/vehicles/VehicleForm'
import { updateVehicleAction } from '@/lib/vehicle-actions'
import type { VehicleData } from '@/lib/vehicle-api'
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
      const result = await updateVehicleAction(vehicle.id, data)
      if (!result.success) {
        setError(result.error)
        return
      }
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
          <PhotoUpload
            key={vehicle.id}
            vehicleId={vehicle.id}
            initialPhotos={vehicle.photos ?? []}
          />
        )}
        {vehicle && (
          <VehicleForm
            key={vehicle.id}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
            isSubmitting={isSubmitting}
            defaultValues={{
              name: vehicle.name,
              ...(vehicle.description != null && { description: vehicle.description }),
              photos: vehicle.photos ?? [],
              seats: vehicle.seats,
              transmission: vehicle.transmission,
              ...(vehicle.fuelType != null && { fuelType: vehicle.fuelType }),
              bufferMinutes: vehicle.bufferMinutes,
              dailyRateJpy: vehicle.dailyRateJpy,
              hourlyRateJpy: vehicle.hourlyRateJpy,
              minRentalHours: vehicle.minRentalHours,
              maxRentalHours: vehicle.maxRentalHours,
              advanceBookingHours: vehicle.advanceBookingHours,
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
