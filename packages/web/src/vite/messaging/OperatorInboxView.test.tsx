import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { MessageDto, ThreadSummaryDto } from './api'

// Mock the router <Link> to a plain anchor so the unit scope stays this view's own
// rendering (mirrors ThreadListView.test).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode; to?: unknown; params?: unknown }) => (
    <a href="#thread">{children}</a>
  ),
}))

import { OperatorInboxView } from './OperatorInboxView'

function message(content: string, createdAt: string): MessageDto {
  return {
    id: `msg_${createdAt}`,
    threadId: 'th_1',
    senderId: 'renter_1',
    content,
    sourceLanguage: 'en',
    translations: {},
    createdAt,
  }
}

function thread(over: Partial<ThreadSummaryDto> = {}): ThreadSummaryDto {
  return {
    id: 'th_1',
    bookingId: 'bk_1',
    operatorUnreadCount: 0,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-23T01:00:00.000Z',
    participants: [],
    lastMessage: message('Pickup is at 10am, see you then', '2026-06-23T01:00:00.000Z'),
    ...over,
  }
}

function renderView(props: Partial<Parameters<typeof OperatorInboxView>[0]> = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <OperatorInboxView threads={[thread()]} locale="en" {...props} />
    </IntlProvider>,
  )
}

describe('OperatorInboxView', () => {
  it('shows the empty state when there are no threads', () => {
    renderView({ threads: [] })
    expect(screen.getByText('No messages yet')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the last-message preview', () => {
    renderView()
    expect(screen.getByText('Pickup is at 10am, see you then')).toBeTruthy()
  })

  it('shows the tenant-level unread count as a pill with an accessible label', () => {
    renderView({ threads: [thread({ operatorUnreadCount: 3 })] })
    const pill = screen.getByRole('status')
    expect(pill.textContent).toBe('3')
    expect(pill.getAttribute('aria-label')).toBe('3 unread')
  })

  it('shows no unread pill when the operator has zero unread', () => {
    renderView({ threads: [thread({ operatorUnreadCount: 0 })] })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('orders rows by latest activity, newest first', () => {
    renderView({
      threads: [
        thread({
          id: 'older',
          lastMessage: message('older', '2026-06-20T00:00:00.000Z'),
        }),
        thread({
          id: 'newer',
          lastMessage: message('newer', '2026-06-25T00:00:00.000Z'),
        }),
      ],
    })
    const previews = screen.getAllByText(/older|newer/)
    expect(previews[0]?.textContent).toBe('newer')
  })
})
