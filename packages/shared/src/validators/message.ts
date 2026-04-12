import { z } from 'zod'

export const createThreadSchema = z.object({
  bookingId: z.string().optional(),
  participantIds: z.array(z.string().min(1)).min(1, 'At least one participant required'),
})

export const sendMessageSchema = z.object({
  senderId: z.string().min(1, 'senderId is required'),
  content: z.string().trim().min(1, 'Message cannot be empty').max(5000),
})

export const markReadSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

export type CreateThreadInput = z.infer<typeof createThreadSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type MarkReadInput = z.infer<typeof markReadSchema>
