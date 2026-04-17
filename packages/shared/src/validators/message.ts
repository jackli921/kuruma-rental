import { z } from 'zod'

export const createThreadSchema = z.object({
  bookingId: z.string().uuid('Must be a valid UUID').optional(),
  participantIds: z
    .array(z.string().uuid('Each participant ID must be a valid UUID'))
    .min(1, 'At least one participant required'),
  idempotencyKey: z.string().uuid('Must be a valid UUID').optional(),
})

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(5000),
  idempotencyKey: z.string().uuid('Must be a valid UUID').optional(),
})

export type CreateThreadInput = z.infer<typeof createThreadSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
