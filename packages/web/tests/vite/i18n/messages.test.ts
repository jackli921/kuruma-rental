import { loadMessages } from '@/vite/i18n/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('loadMessages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches and parses the per-locale messages file by path', async () => {
    const payload = { common: { appName: 'Kuruma Rental' } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadMessages('ja')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('/messages/ja.json')
  })

  it('throws an error naming the locale when the file is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    await expect(loadMessages('zh')).rejects.toThrow('zh')
  })
})
