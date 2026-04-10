import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchThread, fetchThreads, sendMessage } from '@/lib/messaging'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

describe('fetchThreads', () => {
  test('returns parsed threads on success', async () => {
    const thread = {
      id: 'thread_1',
      bookingId: 'booking_1',
      participants: [
        { userId: 'user_1', unreadCount: 0 },
        { userId: 'user_2', unreadCount: 2 },
      ],
      lastMessage: {
        content: 'Hello there',
        senderId: 'user_2',
        createdAt: '2026-04-07T10:00:00Z',
      },
      createdAt: '2026-04-06T09:00:00Z',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [thread] }),
    })

    const result = await fetchThreads('user_1')

    expect(result).toEqual([thread])
  })

  test('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const result = await fetchThreads('user_1')
    expect(result).toEqual([])
  })

  test('returns empty array when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchThreads('user_1')
    expect(result).toEqual([])
  })

  test('returns empty array when response shape is unexpected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ unexpected: true }),
    })

    const result = await fetchThreads('user_1')
    expect(result).toEqual([])
  })
})

describe('fetchThread', () => {
  test('returns parsed thread on success', async () => {
    const thread = {
      id: 'thread_1',
      bookingId: null,
      participants: [{ userId: 'user_1', unreadCount: 0 }],
      messages: [
        {
          id: 'msg_1',
          senderId: 'user_1',
          content: 'Hello',
          createdAt: '2026-04-07T10:00:00Z',
        },
      ],
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: thread }),
    })

    const result = await fetchThread('thread_1')
    expect(result).toEqual(thread)
  })

  test('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await fetchThread('thread_1')
    expect(result).toBeNull()
  })

  test('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await fetchThread('thread_1')
    expect(result).toBeNull()
  })

  test('returns null when response shape is unexpected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false }),
    })
    const result = await fetchThread('thread_1')
    expect(result).toBeNull()
  })
})

describe('sendMessage', () => {
  test('returns true on success and POSTs content to threads endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 'msg_1' } }),
    })

    const result = await sendMessage('thread_1', 'Hello there')

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/threads/thread_1/messages'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content: 'Hello there' }),
      }),
    )
  })

  test('returns false on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 })
    const result = await sendMessage('thread_1', 'Hi')
    expect(result).toBe(false)
  })

  test('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const result = await sendMessage('thread_1', 'Hi')
    expect(result).toBe(false)
  })
})
