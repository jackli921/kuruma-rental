import { z } from 'zod'
import { OPERATOR_APPLICATION_BUSINESS_TYPES, OPERATOR_APPLICATION_FLEET_SIZES } from '../enums'
import { SUPPORTED_LOCALES } from '../i18n/locales'
import { httpUrl } from './url'

// Converts empty strings to undefined so optional URL/text fields can skip
// the httpUrl or string refinement when left blank.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v)

export const operatorApplicationSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(100),
  // Sign-in-first (#877): contactEmail is NOT a client field. The API derives the
  // authoritative applicant email from the authenticated account server-side, so a
  // caller can never spoof it in the request body.
  contactPhone: z.string().trim().min(3).max(40),
  serviceArea: z.string().trim().min(1).max(120),
  estimatedFleetSize: z.enum(OPERATOR_APPLICATION_FLEET_SIZES),
  // Empty string -> undefined -> httpUrl skipped (optional). Non-empty value
  // must pass the http(s)-scheme guard to block javascript: and data: URLs.
  website: z.preprocess(emptyToUndefined, httpUrl.optional()),
  businessLicenseNumber: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  businessType: z.enum(OPERATOR_APPLICATION_BUSINESS_TYPES).optional(),
  message: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
  // Reuse the locale SSoT so this stays in lockstep when a locale is added.
  submittedLocale: z.enum(SUPPORTED_LOCALES),
  // Anti-spam bot trap. A hidden field humans never see, so any non-empty value
  // means a bot filled it. Accept any string here (never a 400) — the route
  // silently no-ops on a filled value so a bot can't learn the field is a trap by
  // watching for a validation error. Not persisted.
  honeypot: z.string().optional(),
  // Consent gate — must be explicitly checked (literal true, not just truthy).
  consent: z.literal(true),
})

export type OperatorApplicationInput = z.infer<typeof operatorApplicationSchema>
