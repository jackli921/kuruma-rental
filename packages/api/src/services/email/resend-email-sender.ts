import type { EmailMessage, EmailSender, SendResult } from './email-sender'

const ENDPOINT = 'https://api.resend.com/emails'
const TIMEOUT_MS = 5000 // email is less latency-sensitive than translate
const MAX_ATTEMPTS = 2 // initial call + 1 retry

interface ResendResponse {
  id?: string
  message?: string
  name?: string
}

/**
 * Resend REST client (POST /emails). REST over the npm SDK so the Cloudflare
 * Workers bundle stays lean and the resilience contract matches
 * GoogleTranslationProvider (#336): a 5s AbortSignal timeout, a single retry on
 * network error / 5xx, and an immediate throw on 4xx (caller error, e.g. a bad
 * address). Throws a typed Error with the Resend message on failure — the
 * dispatcher catches it and records FAILED.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string,
    // CF Workers: the global fetch must be called with this===globalThis, else
    // `this.fetchFn(...)` throws "Illegal invocation" (#887). Bind the default;
    // the injectable param keeps the test mock seam intact.
    private readonly fetchFn: typeof fetch = fetch.bind(globalThis) as typeof fetch,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const body = JSON.stringify({
      from: message.from || this.defaultFrom,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    })

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchFn(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        // 5xx is transient — retry. 4xx is the caller's problem — bail.
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          lastError = new Error(`Resend returned ${response.status}`)
          continue
        }

        const json = (await response.json()) as ResendResponse
        if (!response.ok || !json.id) {
          throw new Error(json.message ?? `Resend returned ${response.status}`)
        }
        return { providerMessageId: json.id }
      } catch (err) {
        if (isNetworkError(err) && attempt < MAX_ATTEMPTS) {
          lastError = err
          continue
        }
        throw err
      }
    }

    throw lastError ?? new Error('Resend: exhausted retries')
  }
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true // fetch failed
  if (err instanceof Error && err.name === 'AbortError') return true // timeout
  if (err instanceof DOMException && err.name === 'TimeoutError') return true
  return false
}
