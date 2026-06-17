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

// Single source for the operator display-name rule so create and update can't
// drift (#903). Trimmed, 1–100 chars.
const nameSchema = z.string().trim().min(1).max(100)

export const createOperatorSchema = z.object({
  name: nameSchema,
  preAuthHandoffUrl: httpUrl.optional(),
})

export type CreateOperatorInput = z.infer<typeof createOperatorSchema>

// Operator self-service profile patch (#903). Every field is optional, but an
// empty patch is rejected (nothing to do). preAuthHandoffUrl is 3-state: key
// absent -> leave column unchanged; explicit null -> clear to NULL; string ->
// must pass the http(s) refine (it is a renter-facing money-flow control).
export const updateOperatorSchema = z
  .object({
    name: nameSchema.optional(),
    preAuthHandoffUrl: httpUrl.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'at least one field is required',
  })

export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>
