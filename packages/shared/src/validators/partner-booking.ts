import { z } from 'zod'

// Partner-originated bookings: Trip.com now, other OTAs later.
const PARTNER_SOURCES = ['TRIP_COM'] as const

export const createPartnerBookingSchema = z
  .object({
    vehicleId: z.string().uuid('vehicleId must be a UUID'),
    renterEmail: z.string().email(),
    renterName: z.string().min(1).max(200),
    renterPhone: z.string().max(40).nullable().optional(),
    renterLanguage: z.enum(['en', 'ja', 'zh']).default('en'),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    source: z.enum(PARTNER_SOURCES).default('TRIP_COM'),
    externalId: z.string().min(1).max(100),
    notes: z.string().max(2000).nullable().optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.startAt), {
    message: 'endAt must be after startAt',
    path: ['endAt'],
  })

export type CreatePartnerBookingInput = z.infer<typeof createPartnerBookingSchema>
