import { z } from 'zod'

export const SUPPORTED_TARGET_LANGUAGES = ['en', 'ja', 'zh'] as const
export type TargetLanguage = (typeof SUPPORTED_TARGET_LANGUAGES)[number]

export const translateMessageSchema = z.object({
  targetLanguage: z.enum(SUPPORTED_TARGET_LANGUAGES),
})

export type TranslateMessageInput = z.infer<typeof translateMessageSchema>
