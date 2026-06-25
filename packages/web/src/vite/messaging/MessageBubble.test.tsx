import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { MessageBubble } from './MessageBubble'
import type { MessageDto } from './api'

const c = en.messaging.thread

function message(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    threadId: 'th_1',
    senderId: 'user_op',
    content: 'こんにちは',
    sourceLanguage: 'ja',
    translations: {},
    createdAt: '2026-06-23T01:00:00.000Z',
    ...over,
  }
}

function renderBubble(props: Partial<Parameters<typeof MessageBubble>[0]> = {}) {
  const onTranslate = props.onTranslate ?? vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <ul>
        <MessageBubble
          message={message()}
          isOwn={false}
          speakerName="Kaku Rentals"
          locale="en"
          onTranslate={onTranslate}
          {...props}
        />
      </ul>
    </IntlProvider>,
  )
  return { onTranslate }
}

describe('MessageBubble', () => {
  it('shows the DTO-cached translation without calling the API, then toggles back', async () => {
    const user = userEvent.setup()
    const { onTranslate } = renderBubble({
      message: message({ content: '10時にお迎えします', translations: { en: 'Pickup at 10am' } }),
    })

    expect(screen.getByText('10時にお迎えします')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: c.translate }))
    expect(screen.getByText('Pickup at 10am')).toBeTruthy()
    expect(onTranslate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: c.showOriginal }))
    expect(screen.getByText('10時にお迎えします')).toBeTruthy()
  })

  it('fetches the translation when not cached, showing a loading state then the result', async () => {
    const user = userEvent.setup()
    let resolve!: (text: string) => void
    const onTranslate = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r
        }),
    )
    renderBubble({ message: message({ content: 'こんにちは', translations: {} }), onTranslate })

    await user.click(screen.getByRole('button', { name: c.translate }))
    expect(onTranslate).toHaveBeenCalledWith('m1', 'en')
    expect(screen.getByLabelText(c.translating)).toBeTruthy()

    resolve('Hello')
    expect(await screen.findByText('Hello')).toBeTruthy()
    expect(screen.getByRole('button', { name: c.showOriginal })).toBeTruthy()
  })

  it('shows an error with a retry that re-attempts the translation', async () => {
    const user = userEvent.setup()
    const onTranslate = vi
      .fn<(id: string, lang: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce('Hello')
    renderBubble({ message: message({ content: 'こんにちは', translations: {} }), onTranslate })

    await user.click(screen.getByRole('button', { name: c.translate }))
    expect(await screen.findByText(c.translationUnavailable)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: c.retry }))
    expect(await screen.findByText('Hello')).toBeTruthy()
    expect(onTranslate).toHaveBeenCalledTimes(2)
  })
})
