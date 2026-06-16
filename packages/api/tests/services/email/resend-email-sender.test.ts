import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '../../../src/services/email/email-sender'
import { ResendEmailSender } from '../../../src/services/email/resend-email-sender'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const message: EmailMessage = {
  to: 'renter@example.com',
  from: 'Best Car Rental <noreply@bestcarrental.jp>',
  subject: 'Booking confirmed — ABCD2345',
  html: '<p>hi</p>',
  text: 'hi',
  replyTo: 'ops@bestcarrental.jp',
}

describe('ResendEmailSender', () => {
  it('POSTs to the Resend endpoint with bearer auth + JSON body and maps {id}', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 'resend-123' }))
    const sender = new ResendEmailSender('re_test_key', 'fallback@from', fetchFn)

    const result = await sender.send(message)
    expect(result).toEqual({ providerMessageId: 'resend-123' })

    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_test_key')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init?.body as string)
    expect(body).toMatchObject({
      to: 'renter@example.com',
      from: 'Best Car Rental <noreply@bestcarrental.jp>',
      subject: 'Booking confirmed — ABCD2345',
      html: '<p>hi</p>',
      text: 'hi',
      reply_to: 'ops@bestcarrental.jp',
    })
  })

  it('passes an AbortSignal so a hung upstream cannot block forever', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 'x' }))
    await new ResendEmailSender('k', 'f', fetchFn).send(message)
    expect(fetchFn.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws with the Resend error message on a non-2xx response', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ message: 'Invalid `to` field', name: 'validation_error' }, { status: 422 }),
    )
    await expect(new ResendEmailSender('k', 'f', fetchFn).send(message)).rejects.toThrow(
      'Invalid `to` field',
    )
  })

  it('retries once on 5xx and returns the id from the retry', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'upstream' }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'resend-retry' }))
    const result = await new ResendEmailSender('k', 'f', fetchFn).send(message)
    expect(result.providerMessageId).toBe('resend-retry')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('retries once on a network error', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ id: 'resend-net' }))
    const result = await new ResendEmailSender('k', 'f', fetchFn).send(message)
    expect(result.providerMessageId).toBe('resend-net')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 4xx — client errors are not transient', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'bad address' }, { status: 422 }))
    await expect(new ResendEmailSender('k', 'f', fetchFn).send(message)).rejects.toThrow(
      'bad address',
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('falls back to the configured from when the message omits it', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 'x' }))
    await new ResendEmailSender('k', 'configured@from', fetchFn).send({ ...message, from: '' })
    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string)
    expect(body.from).toBe('configured@from')
  })

  it('binds the default fetch to globalThis so a CF Workers send does not throw Illegal invocation (#887)', async () => {
    // CF Workers' global fetch is a branded builtin that throws unless called with
    // this === globalThis. Node/vitest don't brand it, so simulate the branding and
    // exercise the DEFAULT fetchFn — the prod path that silently killed every email.
    const brandedFetch = async function (this: unknown): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
      }
      return jsonResponse({ id: 'resend-bound' })
    }
    vi.stubGlobal('fetch', brandedFetch)
    try {
      const result = await new ResendEmailSender('re_key', 'noreply@from').send(message)
      expect(result).toEqual({ providerMessageId: 'resend-bound' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
