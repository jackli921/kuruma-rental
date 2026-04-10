import { z } from 'zod'

export const createVehicleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  photos: z.array(z.string().url()).default([]),
  seats: z.number().int().min(1, 'Must have at least 1 seat').max(50),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().optional(),
  bufferMinutes: z.number().int().min(0).default(60),
  minRentalHours: z.number().int().min(1).optional(),
  maxRentalHours: z.number().int().min(1).optional(),
  advanceBookingHours: z.number().int().min(0).optional(),
})

export const updateVehicleSchema = createVehicleSchema.partial()

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type CreateVehicleFormInput = z.input<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
