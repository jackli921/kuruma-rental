import { ParseError } from '@/lib/api-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type MessageDto,
  type ThreadDetailDto,
  type ThreadSummaryDto,
  type UserSummaryDto,
  fetchThreadById,
  fetchThreads,
  fetchUsersByIds,
  markThreadRead,
  sendMessage,
  translateMessage,
} from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => fetchMock.mockReset())

const message: MessageDto = {
  id: 'msg_1',
  threadId: 'th_1',
  senderId: 'user_renter',
  content: 'Hello, what time is pickup?',
  sourceLanguage: 'en',
  translations: { ja: 'こんにちは、ピックアップは何時ですか?' },
  createdAt: '2026-06-23T00:00:00.000Z',
}

const participant = { id: 'tp_1', threadId: 'th_1', userId: 'user_renter', unreadCount: 2 }

const summary: ThreadSummaryDto = {
  id: 'th_1',
  bookingId: 'bk_1',
  operatorUnreadCount: 0,
  createdAt: '2026-06-22T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  participants: [participant, { ...participant, id: 'tp_2', userId: 'user_op', unreadCount: 0 }],
  lastMessage: message,
}

const detail: ThreadDetailDto = {
  id: 'th_1',
  bookingId: 'bk_1',
  operatorUnreadCount: 0,
  createdAt: '2026-06-22T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  participants: summary.participants,
  messages: [message],
}

describe('fetchThreads', () => {
  it('GETs /api/threads with credentials and unwraps validated summaries', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [summary] }))

    const result = await fetchThreads()

    expect(fetchMock).toHaveBeenCalledWith('/api/threads?limit=100', { credentials: 'include' })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('th_1')
    expect(result[0]?.participants[0]?.unreadCount).toBe(2)
    expect(result[0]?.lastMessage?.content).toBe('Hello, what time is pickup?')
  })

  it('accepts a null lastMessage (a thread with no messages yet)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...summary, lastMessage: null }] }),
    )
    const result = await fetchThreads()
    expect(result[0]?.lastMessage).toBeNull()
  })

  it('throws a ParseError when a message is missing its content (contract drift)', async () => {
    const { content: _omitted, ...broken } = message
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...summary, lastMessage: broken }] }),
    )
    await expect(fetchThreads()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('fetchThreadById', () => {
  it('GETs /api/threads/:id and unwraps the message list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: detail }))

    const result = await fetchThreadById('th_1')

    expect(fetchMock).toHaveBeenCalledWith('/api/threads/th_1', { credentials: 'include' })
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0]?.translations).toEqual({
      ja: 'こんにちは、ピックアップは何時ですか?',
    })
  })

  it('returns null on a 404 (thread not found / not a participant)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Thread not found' }, 404))
    expect(await fetchThreadById('nope')).toBeNull()
  })
})

describe('sendMessage', () => {
  it('POSTs the content + idempotencyKey with the CSRF token and returns the message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: message }, 201))

    const result = await sendMessage('th_1', 'Hi there', 'idem-1', 'csrf-abc')

    expect(fetchMock).toHaveBeenCalledWith('/api/threads/th_1/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-abc' },
      body: JSON.stringify({ content: 'Hi there', idempotencyKey: 'idem-1' }),
    })
    expect(result.id).toBe('msg_1')
  })
})

describe('markThreadRead', () => {
  it('POSTs /api/threads/:id/read with the CSRF token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))

    await markThreadRead('th_1', 'csrf-abc')

    expect(fetchMock).toHaveBeenCalledWith('/api/threads/th_1/read', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-abc' },
    })
  })
})

describe('fetchUsersByIds', () => {
  it('GETs /api/users?ids= (comma-joined, encoded) and unwraps {id,name} summaries', async () => {
    const users: UserSummaryDto[] = [
      { id: 'user_op', name: 'Kaku Rentals' },
      { id: 'user_renter', name: null },
    ]
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: users }))

    const result = await fetchUsersByIds(['user_op', 'user_renter'])

    expect(fetchMock).toHaveBeenCalledWith('/api/users?ids=user_op%2Cuser_renter', {
      credentials: 'include',
    })
    expect(result).toEqual(users)
  })

  it('returns [] without hitting the network when given no ids', async () => {
    const result = await fetchUsersByIds([])

    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a ParseError when a user summary omits its id (contract drift)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ name: 'No Id' }] }))
    await expect(fetchUsersByIds(['user_op'])).rejects.toBeInstanceOf(ParseError)
  })
})

describe('translateMessage', () => {
  it('POSTs the target language and returns {translatedText, language, cached}', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { translatedText: 'Pickup is 10am', language: 'en', cached: false },
      }),
    )

    const result = await translateMessage('msg_1', 'en', 'csrf-abc')

    expect(fetchMock).toHaveBeenCalledWith('/api/messages/msg_1/translate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-abc' },
      body: JSON.stringify({ targetLanguage: 'en' }),
    })
    expect(result).toEqual({ translatedText: 'Pickup is 10am', language: 'en', cached: false })
  })
})
