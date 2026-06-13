import { z } from 'zod'
import { OPERATOR_ROLES } from '../enums'

// Operator-role values come from the enum SSoT (#688), which the `operator_role`
// pgEnum also consumes — so the validator and the column can never drift. The
// `../enums` subpath is zero-import (no drizzle), keeping this validator
// DB-free. The typed projection onto users.role lives in api
// (operatorRoleToUserRole) so a future enum drift is a compile error (#521 §4).
export const operatorRoleSchema = z.enum(OPERATOR_ROLES)
export type OperatorRole = z.infer<typeof operatorRoleSchema>

// Platform-admin mints a provider invite (#521 §7). Email is lowercased here so
// the stored value and the verified-email compare at accept both use one form
// (emails treated as opaque — no Gmail dot canonicalization).
export const createProviderInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Must be a valid email')
    .transform((value) => value.toLowerCase()),
  operatorId: z.string().trim().min(1, 'operatorId is required'),
  role: operatorRoleSchema,
})

export type CreateProviderInviteInput = z.infer<typeof createProviderInviteSchema>
