import { z } from 'zod'

// Admin-only operator creation (env-gated POST /admin/operators, proposal §9
// item 23). The slug is server-derived from the name, never client-supplied
// (proposal §9 item 15), so it is not part of the input.
export const createOperatorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  preAuthHandoffUrl: z.string().url().optional(),
})

export type CreateOperatorInput = z.infer<typeof createOperatorSchema>
