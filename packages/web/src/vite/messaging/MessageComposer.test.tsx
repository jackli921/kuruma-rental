import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { MessageComposer } from './MessageComposer'

function renderComposer(props: Partial<Parameters<typeof MessageComposer>[0]> = {}) {
  const onSend = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <MessageComposer onSend={onSend} pending={false} disabled={false} {...props} />
    </IntlProvider>,
  )
  return { onSend }
}

const c = en.messaging.thread

describe('MessageComposer', () => {
  it('sends the trimmed content and clears the input', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSend } = renderComposer()
    const input = screen.getByLabelText(c.composeLabel)

    await user.type(input, '  hello there  ')
    await user.click(screen.getByRole('button', { name: c.send }))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect((input as HTMLTextAreaElement).value).toBe('')
  })

  it('does not send when the input is empty or whitespace', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSend } = renderComposer()

    await user.type(screen.getByLabelText(c.composeLabel), '   ')
    await user.click(screen.getByRole('button', { name: c.send }))

    expect(onSend).not.toHaveBeenCalled()
  })

  it('blocks sending while a send is pending', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSend } = renderComposer({ pending: true })

    await user.type(screen.getByLabelText(c.composeLabel), 'hi')
    await user.click(screen.getByRole('button', { name: c.send }))

    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables the composer and shows the reason when disabled', async () => {
    const user = userEvent.setup({ delay: null })
    const { onSend } = renderComposer({
      disabled: true,
      disabledReason: 'This booking was cancelled',
    })

    expect(screen.getByText('This booking was cancelled')).toBeTruthy()
    const input = screen.getByLabelText(c.composeLabel)
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: c.send }))
    expect(onSend).not.toHaveBeenCalled()
  })
})
