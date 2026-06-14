import type { CallerContext } from '../middleware/auth'
import type { MessageRepository } from '../repositories/types'
import type { TranslationProvider } from './translation-provider'

export type TranslateResult =
  | { ok: true; translatedText: string; language: string; cached: boolean }
  | { ok: false; status: number; error: string }

export class MessageTranslationService {
  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly provider: TranslationProvider,
  ) {}

  async translate(
    ctx: CallerContext,
    messageId: string,
    targetLanguage: string,
  ): Promise<TranslateResult> {
    // Scope the lookup to the caller — a non-participant gets 404, not the
    // stranger's message content via translatedText.
    const message = await this.messageRepo.findById(ctx, messageId)
    if (!message) return { ok: false, status: 404, error: 'Message not found' }

    const cache = message.translations
    if (cache[targetLanguage]) {
      return {
        ok: true,
        translatedText: cache[targetLanguage],
        language: targetLanguage,
        cached: true,
      }
    }

    let translatedText: string
    let detectedLanguage: string
    try {
      const result = await this.provider.translate(
        message.content,
        message.sourceLanguage,
        targetLanguage,
      )
      translatedText = result.translatedText
      detectedLanguage = result.detectedLanguage
    } catch (err) {
      console.error('Translation provider failed', {
        messageId,
        targetLanguage,
        err: err instanceof Error ? err.message : String(err),
      })
      return { ok: false, status: 502, error: 'Translation provider unavailable' }
    }

    // Persist translation and (if we didn't know it before) the detected source.
    const sourceToPersist = message.sourceLanguage ? null : detectedLanguage
    await this.messageRepo.updateTranslation(
      messageId,
      targetLanguage,
      translatedText,
      sourceToPersist,
    )

    return { ok: true, translatedText, language: targetLanguage, cached: false }
  }
}
