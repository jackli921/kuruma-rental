// Slice 6 / #391 CI regression: on a slow runner Playwright fills #from/#to
// before React hydrates. A *controlled* form reconciles the inputs back to
// empty state on hydrate, then the `required` empty inputs make the browser
// block the native submit — so the chosen range never reaches the URL and
// `/en/search` loads with no params (toHaveURL fails 9x, all retries).
//
// This pins the fix: the form must read the submitted values from the FORM
// (DOM), not from React state, so values that arrive before hydration survive.
// We reproduce the race by setting input.value directly (no React onChange)
// and submitting.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const mockPush = vi.fn()
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { StorefrontSearchForm } from '@/modules/storefronts/components/StorefrontSearchForm'

describe('StorefrontSearchForm', () => {
  beforeEach(() => mockPush.mockClear())
  afterEach(() => cleanup())

  it('pushes the chosen range from the form even when state was not updated (hydration race)', () => {
    const { container } = render(<StorefrontSearchForm />)

    const from = container.querySelector('#from') as HTMLInputElement
    const to = container.querySelector('#to') as HTMLInputElement
    // Set the DOM value WITHOUT firing React onChange — mirrors a pre-hydration
    // Playwright fill. A controlled form's state stays empty here.
    from.value = '2026-07-01T10:00'
    to.value = '2026-07-03T10:00'

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockPush).toHaveBeenCalledTimes(1)
    const url = mockPush.mock.calls[0]?.[0] as string
    expect(url).toContain('from=2026-07-01T10%3A00')
    expect(url).toContain('to=2026-07-03T10%3A00')
  })

  it('prefills from defaults and pushes them on submit', () => {
    const { container } = render(
      <StorefrontSearchForm defaultFrom="2026-08-01T09:00" defaultTo="2026-08-02T09:00" />,
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    const url = mockPush.mock.calls[0]?.[0] as string
    expect(url).toContain('from=2026-08-01T09%3A00')
    expect(url).toContain('to=2026-08-02T09%3A00')
  })
})
