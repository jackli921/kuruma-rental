import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { MessageDto, ThreadSummaryDto } from './api'

// The router <Link> is a navigation primitive — mock it to a plain anchor so the
// unit scope stays the inbox's own rendering (mirrors BusinessSidebar.test).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode; to?: unknown; params?: unknown }) => (
    <a href="#thread">{children}</a>
  ),
}))

import { ThreadListView } from './ThreadListView'

const ME = 'user_renter'

function message(content: string): MessageDto {
  return {
    id: 'msg_1',
    threadId: 'th_1',
    senderId: 'user_op',
    content,
    sourceLanguage: 'en',
    translations: {},
    createdAt: '2026-06-23T01:00:00.000Z',
  }
}

function thread(over: Partial<ThreadSummaryDto> = {}): ThreadSummaryDto {
  return {
    id: 'th_1',
    bookingId: 'bk_1',
    operatorUnreadCount: 0,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-23T01:00:00.000Z',
    participants: [
      { id: 'tp_1', threadId: 'th_1', userId: ME, unreadCount: 2 },
      { id: 'tp_2', threadId: 'th_1', userId: 'user_op', unreadCount: 0 },
    ],
    lastMessage: message('Pickup is at 10am, see you then'),
    ...over,
  }
}

function renderView(props: Partial<Parameters<typeof ThreadListView>[0]> = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ThreadListView
        threads={[thread()]}
        namesById={{ user_op: 'Kaku Rentals' }}
        currentUserId={ME}
        locale="en"
        {...props}
      />
    </IntlProvider>,
  )
}

describe('ThreadListView', () => {
  it('shows the empty state when there are no threads', () => {
    renderView({ threads: [] })
    expect(screen.getByText('No messages yet')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('labels the row with the counterpart name (not the renter themselves)', () => {
    renderView()
    const link = screen.getByRole('link')
    expect(link.textContent).toContain('Kaku Rentals')
    expect(link.textContent).not.toContain(ME)
  })

  it('renders the last-message preview', () => {
    renderView()
    expect(screen.getByText('Pickup is at 10am, see you then')).toBeTruthy()
  })

  it('shows my unread count as a pill with an accessible label', () => {
    renderView()
    const pill = screen.getByRole('status')
    expect(pill.textContent).toBe('2')
    expect(pill.getAttribute('aria-label')).toBe('2 unread')
  })

  it('shows no unread pill when my participant has zero unread', () => {
    renderView({
      threads: [
        thread({
          participants: [
            { id: 'tp_1', threadId: 'th_1', userId: ME, unreadCount: 0 },
            { id: 'tp_2', threadId: 'th_1', userId: 'user_op', unreadCount: 5 },
          ],
        }),
      ],
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('falls back to the Host label when the counterpart name is unknown', () => {
    renderView({ namesById: {} })
    expect(screen.getByRole('link').textContent).toContain('Host')
  })
})
