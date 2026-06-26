import { z } from 'zod'
import { VEHICLE_BLOCK_KINDS } from '../enums'

// #1101: a scheduled vehicle block (maintenance / out-of-service / manual hold).
// operatorId, vehicleId, and createdBy are ALL server-derived — the route resolves
// the vehicle in the caller's tenant and stamps them, so they are intentionally
// absent here (Zod strips unknown keys, so a client that injects operatorId has it
// silently dropped). startAt/endAt are ISO strings on the wire (mirrors bookings);
// the service converts them to Date before the repo write.
export const createVehicleBlockSchema = z
  .object({
    kind: z.enum(VEHICLE_BLOCK_KINDS),
    reason: z.string().trim().min(1, 'Reason is required').max(500),
    startAt: z.string().datetime({ message: 'startAt must be an ISO datetime' }),
    endAt: z.string().datetime({ message: 'endAt must be an ISO datetime' }),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'endAt must be after startAt',
    path: ['endAt'],
  })

export type CreateVehicleBlockInput = z.infer<typeof createVehicleBlockSchema>
