import { z } from 'zod'

// Admin-only operator creation (env-gated POST /admin/operators, proposal §9
// item 23). The slug is server-derived from the name, never client-supplied
// (proposal §9 item 15), so it is not part of the input.
// preAuthHandoffUrl is rendered/linked in a renter-facing pre-auth payment
// handoff, so `z.string().url()` alone is unsafe — it admits `javascript:` and
// `ftp:`. Constrain to http(s) to close the open-redirect / XSS vector (#386).
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const { protocol } = new URL(value)
        return protocol === 'http:' || protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'must be an http(s) URL' },
  )

export const createOperatorSchema = z.object({
  name: z.string().trim().min(1).max(100),
  preAuthHandoffUrl: httpUrl.optional(),
})

export type CreateOperatorInput = z.infer<typeof createOperatorSchema>
