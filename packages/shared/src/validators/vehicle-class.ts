import { z } from 'zod'

const jpyRate = z.number().int('Rate must be a whole yen amount').min(0, 'Rate cannot be negative')

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const vehicleClassObjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(100)
    .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
  photos: z.array(z.string().url()).default([]),
  seats: z.number().int().min(1, 'Must have at least 1 seat').max(50),
  luggageCapacity: z.number().int().min(0, 'Luggage capacity cannot be negative'),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().optional(),
  dailyRateJpy: jpyRate.nullish(),
  hourlyRateJpy: jpyRate.nullish(),
  sortOrder: z.number().int().min(0).default(0),
})

export const createVehicleClassSchema = vehicleClassObjectSchema.superRefine((data, ctx) => {
  if (data.dailyRateJpy == null && data.hourlyRateJpy == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dailyRateJpy'],
      message: 'At least one rate (daily or hourly) is required',
    })
  }
})

export const updateVehicleClassSchema = vehicleClassObjectSchema
  .partial()
  .superRefine((data, ctx) => {
    if ('dailyRateJpy' in data && 'hourlyRateJpy' in data) {
      if (data.dailyRateJpy == null && data.hourlyRateJpy == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dailyRateJpy'],
          message: 'At least one rate (daily or hourly) is required',
        })
      }
    }
  })

export type CreateVehicleClassInput = z.infer<typeof createVehicleClassSchema>
export type CreateVehicleClassFormInput = z.input<typeof createVehicleClassSchema>
export type UpdateVehicleClassInput = z.infer<typeof updateVehicleClassSchema>
