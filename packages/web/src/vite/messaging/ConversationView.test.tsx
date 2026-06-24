import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { MessageDto } from './api'

// Only the network writes are faked; THREADS_QUERY_KEY + threadByIdQueryKey stay
// real so the invalidations target the genuine cache entries the inbox/badge and
// the open thread read from (mirrors ManualBookingDialog.test).
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  markThreadRead: vi.fn(),
  sendMessage: vi.fn(),
}))

import { ConversationView } from './ConversationView'
import { THREADS_QUERY_KEY, markThreadRead, sendMessage, threadByIdQueryKey } from './api'

const ME = 'user_renter'
const THREAD = 'th_1'
const c = en.messaging.thread

function message(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    threadId: THREAD,
    senderId: 'user_op',
    content: 'welcome',
    sourceLanguage: 'en',
    translations: {},
    createdAt: '2026-06-23T01:00:00.000Z',
    ...over,
  }
}

function renderView(props: Partial<Parameters<typeof ConversationView>[0]> = {}) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  render(
    <ConversationView
      threadId={THREAD}
      currentUserId={ME}
      messages={[message()]}
      counterpartName="Kaku Rentals"
      disabled={false}
      csrfToken="csrf-tok"
      locale="en"
      {...props}
    />,
    { wrapper },
  )
  return { invalidate }
}

beforeEach(() => {
  vi.mocked(markThreadRead).mockReset().mockResolvedValue(undefined)
  vi.mocked(sendMessage)
    .mockReset()
    .mockResolvedValue(message({ id: 'm2', senderId: ME }))
})

describe('ConversationView', () => {
  it('marks the thread read on mount and clears the threads cache (badge)', async () => {
    const { invalidate } = renderView()
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledWith(THREAD, 'csrf-tok'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: THREADS_QUERY_KEY })
  })

  it('still renders the transcript when marking the thread read fails', async () => {
    vi.mocked(markThreadRead).mockReset().mockRejectedValue(new Error('network down'))
    renderView()
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledWith(THREAD, 'csrf-tok'))
    // A failed read is non-critical — the badge just lingers until the next poll;
    // it must not reject unhandled or tear down the conversation.
    expect(screen.getByText('welcome')).toBeTruthy()
  })

  it('sends the typed message with a uuid idempotency key + csrf, then refetches', async () => {
    const user = userEvent.setup({ delay: null })
    const { invalidate } = renderView()

    await user.type(screen.getByLabelText(c.composeLabel), 'on my way')
    await user.click(screen.getByRole('button', { name: c.send }))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    const [threadId, content, key, token] = vi.mocked(sendMessage).mock.calls[0]!
    expect(threadId).toBe(THREAD)
    expect(content).toBe('on my way')
    expect(token).toBe('csrf-tok')
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: threadByIdQueryKey(THREAD) }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: THREADS_QUERY_KEY })
  })
})
