import { z } from 'zod'

import { SUPPORTED_LOCALES } from '../i18n/locales'

// A message's translation targets are exactly the platform's supported locales;
// anchor this to the single source of truth instead of a parallel literal.
export const SUPPORTED_TARGET_LANGUAGES = SUPPORTED_LOCALES
export type TargetLanguage = (typeof SUPPORTED_TARGET_LANGUAGES)[number]

export const translateMessageSchema = z.object({
  targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES),
})

export type TranslateMessageInput = z.infer<typeof translateMessageSchema>
