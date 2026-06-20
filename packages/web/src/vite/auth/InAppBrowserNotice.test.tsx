import { act, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { InAppBrowserNotice } from './InAppBrowserNotice'

const WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002824) NetType/WIFI Language/en'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

function renderNotice() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <InAppBrowserNotice />
    </IntlProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InAppBrowserNotice', () => {
  it('warns and offers a copy-link inside an in-app webview (WeChat)', () => {
    setUserAgent(WECHAT)
    renderNotice()
    expect(screen.getByRole('alert').textContent).toContain(en.auth.inAppBrowser.title)
    expect(screen.getByRole('button', { name: en.auth.inAppBrowser.copyLink })).toBeTruthy()
  })

  it('renders nothing in a normal browser (desktop Chrome)', () => {
    setUserAgent(DESKTOP_CHROME)
    const { container } = renderNotice()
    expect(container.firstChild).toBeNull()
  })

  it('copies the current page URL and confirms when the copy-link button is tapped', async () => {
    setUserAgent(WECHAT)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderNotice()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.auth.inAppBrowser.copyLink }))
    })
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(screen.getByRole('button', { name: en.auth.inAppBrowser.copied })).toBeTruthy()
  })
})
