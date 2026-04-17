import { z } from 'zod'

export const quickCreateCustomerSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
    language: z.enum(['en', 'ja', 'zh']).default('en'),
  })
  .refine((data) => data.email || data.phone, {
    message: 'At least one of email or phone is required',
  })

export type QuickCreateCustomerInput = z.infer<typeof quickCreateCustomerSchema>
