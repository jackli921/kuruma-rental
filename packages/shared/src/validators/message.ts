import { z } from 'zod'

export const createThreadSchema = z.object({
  bookingId: z.string().uuid('Must be a valid UUID').optional(),
  participantIds: z
    .array(z.string().uuid('Each participant ID must be a valid UUID'))
    .min(1, 'At least one participant required'),
})

export const sendMessageSchema = z.object({
  // senderId is derived from JWT in the route; kept optional for backward compat
  senderId: z.string().uuid('senderId must be a valid UUID').optional(),
  content: z.string().trim().min(1, 'Message cannot be empty').max(5000),
})

// userId is derived from JWT in the route; schema kept for body structure validation
export const markReadSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID').optional(),
})

export type CreateThreadInput = z.infer<typeof createThreadSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type MarkReadInput = z.infer<typeof markReadSchema>
