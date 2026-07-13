import { z } from 'zod'
import { jpyAmount } from './money'

const dayRateSchema = jpyAmount('Day rate')

const classRatePlanObjectSchema = z.object({
  classId: z.string().uuid('classId must be a UUID'),
  pickupLocationId: z.string().uuid('pickupLocationId must be a UUID'),
  dayRateJpy: dayRateSchema,
  // Operator-only display name. Never surfaced to renters.
  label: z
    .string()
    .trim()
    .min(1, 'label must not be blank')
    .max(80, 'label must be 80 characters or fewer')
    .nullish(),
  isActive: z.boolean().optional(),
})

export const createClassRatePlanSchema = classRatePlanObjectSchema

// Platform-admin writes are cross-tenant so they must name the target operator
// explicitly (mirrors platformAdminCreateFeeScheduleSchema).
export const platformAdminCreateClassRatePlanSchema = classRatePlanObjectSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

// .partial() so a PATCH can carry any subset of fields.
export const updateClassRatePlanSchema = classRatePlanObjectSchema.partial()

export type CreateClassRatePlanInput = z.infer<typeof createClassRatePlanSchema>
export type CreateClassRatePlanFormInput = z.input<typeof createClassRatePlanSchema>
export type PlatformAdminCreateClassRatePlanInput = z.infer<
  typeof platformAdminCreateClassRatePlanSchema
>
export type UpdateClassRatePlanInput = z.infer<typeof updateClassRatePlanSchema>
