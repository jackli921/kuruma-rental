import { z } from 'zod'
import { OPERATOR_APPLICATION_BUSINESS_TYPES, OPERATOR_APPLICATION_FLEET_SIZES } from '../enums'
import { httpUrl } from './url'

// Converts empty strings to undefined so optional URL/text fields can skip
// the httpUrl or string refinement when left blank.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

export const operatorApplicationSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(100),
  // Email is lowercased so stored value and comparison always use one form.
  // Mirrors the same pattern in provider-invite.ts.
  contactEmail: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Must be a valid email')
    .transform((v) => v.toLowerCase()),
  contactPhone: z.string().trim().min(3).max(40),
  serviceArea: z.string().trim().min(1).max(120),
  estimatedFleetSize: z.enum(OPERATOR_APPLICATION_FLEET_SIZES),
  // Empty string -> undefined -> httpUrl skipped (optional). Non-empty value
  // must pass the http(s)-scheme guard to block javascript: and data: URLs.
  website: z.preprocess(emptyToUndefined, httpUrl.optional()),
  businessLicenseNumber: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  businessType: z.enum(OPERATOR_APPLICATION_BUSINESS_TYPES).optional(),
  message: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  // No locales module exists in this package; inlined to keep this file self-contained.
  submittedLocale: z.enum(['en', 'ja', 'zh']),
  // Anti-spam bot trap — must be absent or empty. Not persisted.
  honeypot: z.string().max(0).optional(),
  // Consent gate — must be explicitly checked (literal true, not just truthy).
  consent: z.literal(true),
})

export type OperatorApplicationInput = z.infer<typeof operatorApplicationSchema>
