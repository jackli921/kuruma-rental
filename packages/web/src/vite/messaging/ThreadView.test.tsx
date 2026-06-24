import { render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { ThreadView } from './ThreadView'
import type { MessageDto } from './api'

const ME = 'user_renter'

function message(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'msg_1',
    threadId: 'th_1',
    senderId: 'user_op',
    content: 'Pickup is at 10am',
    sourceLanguage: 'en',
    translations: {},
    createdAt: '2026-06-23T01:00:00.000Z',
    ...over,
  }
}

function renderView(props: Partial<Parameters<typeof ThreadView>[0]> = {}) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ThreadView
        messages={[]}
        currentUserId={ME}
        counterpartName="Kaku Rentals"
        locale="en"
        onTranslate={vi.fn()}
        {...props}
      />
    </IntlProvider>,
  )
}

// `data-own` marks the speaker side; alignment classes follow from it, so the
// test asserts the semantic flag rather than brittle Tailwind utilities.
function bubbleFor(content: string): HTMLElement {
  const node = screen.getByText(content).closest('[data-own]')
  if (!node) throw new Error(`no bubble for "${content}"`)
  return node as HTMLElement
}

describe('ThreadView', () => {
  it('shows the empty state when there are no messages', () => {
    renderView()
    expect(screen.getByText('No messages in this conversation yet.')).toBeTruthy()
  })

  it('marks my own messages as own and labels them "You"', () => {
    renderView({ messages: [message({ id: 'm', senderId: ME, content: 'see you there' })] })
    const bubble = bubbleFor('see you there')
    expect(bubble.getAttribute('data-own')).toBe('true')
    expect(within(bubble).getByText('You')).toBeTruthy()
  })

  it('marks counterpart messages as foreign and labels them with the counterpart name', () => {
    renderView({ messages: [message({ content: 'welcome aboard' })] })
    const bubble = bubbleFor('welcome aboard')
    expect(bubble.getAttribute('data-own')).toBe('false')
    expect(within(bubble).getByText('Kaku Rentals')).toBeTruthy()
  })

  it('renders messages in order with both speakers', () => {
    renderView({
      messages: [
        message({ id: 'a', senderId: 'user_op', content: 'first' }),
        message({ id: 'b', senderId: ME, content: 'second' }),
      ],
    })
    expect(bubbleFor('first').getAttribute('data-own')).toBe('false')
    expect(bubbleFor('second').getAttribute('data-own')).toBe('true')
  })
})
