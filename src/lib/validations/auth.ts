import { z } from 'zod'

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required'),
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters'),
})

export type RegisterInput = z.infer<typeof registerSchema>
