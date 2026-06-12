import { z } from 'zod'

// Operator-role values mirror the `operator_role` pgEnum (shared/db/provider-access).
// Kept as a standalone z.enum so this validator stays drizzle-free. The typed
// projection onto users.role lives in api (operatorRoleToUserRole) so a future
// enum drift is a compile error, not a silent bad row (#521 §4).
export const operatorRoleSchema = z.enum(['OPERATOR_OWNER', 'OPERATOR_STAFF'])
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
