import { z } from 'zod'

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message cannot be empty').max(5000),
  idempotencyKey: z.string().uuid('Must be a valid UUID').optional(),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>
