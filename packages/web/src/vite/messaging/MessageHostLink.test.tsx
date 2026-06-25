import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Router <Link> is a navigation primitive — stub it to a plain anchor that
// surfaces the typed destination + params so we assert where it points.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string
    params?: { locale?: string; threadId?: string }
    children: ReactNode
  }) => (
    <a href={to} data-to={to} data-locale={params?.locale} data-thread={params?.threadId}>
      {children}
    </a>
  ),
}))

import { MessageHostLink } from './MessageHostLink'

describe('MessageHostLink', () => {
  it('links to the booking thread with the message-host label', () => {
    render(
      <IntlProvider locale="en" messages={en}>
        <MessageHostLink threadId="th_9" locale="en" />
      </IntlProvider>,
    )
    const link = screen.getByRole('link', { name: en.messaging.entry.messageHost })
    expect(link.getAttribute('data-to')).toBe('/$locale/messages/$threadId')
    expect(link.getAttribute('data-thread')).toBe('th_9')
    expect(link.getAttribute('data-locale')).toBe('en')
  })
})
