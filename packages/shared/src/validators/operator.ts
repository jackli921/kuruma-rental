import { z } from 'zod'
import { httpUrl } from './url'

// Admin-only operator creation (env-gated POST /admin/operators, proposal §9
// item 23). The slug is server-derived from the name, never client-supplied
// (proposal §9 item 15), so it is not part of the input.
// preAuthHandoffUrl is rendered/linked in a renter-facing pre-auth payment
// handoff, so `z.string().url()` alone is unsafe — it admits `javascript:` and
// `ftp:`. The shared httpUrl (validators/url.ts) closes that open-redirect / XSS
// vector (#386) — the same refine vehicle/class photos now use (#967).

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
