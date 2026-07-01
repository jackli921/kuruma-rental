import type { FxRates } from '@kuruma/shared/types/fx'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { CurrencyProvider } from './CurrencyProvider'
import { IndicativeNote } from './IndicativeNote'

const rates: FxRates = { base: 'JPY', asOf: '2026-06-01', rates: { USD: 0.0067 } }

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  // Multi-currency (#1070) ships OFF in beta; the note only renders when ON. The
  // gated-off path is covered by its own test below.
  vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', 'true')
  localStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: rates }),
  })
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

function renderInProvider(ui: ReactNode, locale = 'en') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale={locale} messages={en}>
        <CurrencyProvider>{ui}</CurrencyProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('IndicativeNote', () => {
  it('shows the indicative converted figure once rates load (USD)', async () => {
    renderInProvider(<IndicativeNote jpy={27000} />, 'en')
    // 27000 * 0.0067 = 180.9 -> "$181"
    await waitFor(() => expect(screen.getByText(/≈ \$181/)).toBeTruthy())
  })

  it('reads a localized "approximately" to screen readers, hiding the bare ≈ glyph (a11y)', async () => {
    const { container } = renderInProvider(<IndicativeNote jpy={27000} />, 'en')
    // Screen readers get the spelled-out phrase, not a glyph that may read as
    // "almost equal to" or be skipped entirely.
    await waitFor(() => expect(screen.getByText(`${en.currency.approximately} $181`)).toBeTruthy())
    // The visible ≈ run is present but excluded from the accessibility tree, so the
    // figure is never announced twice.
    const glyph = container.querySelector('[aria-hidden="true"]')
    expect(glyph?.textContent).toContain('≈ $181')
  })

  it('keeps the converted figure after the ≈ so a cell parser reading yen-before-≈ is unaffected', async () => {
    // Mirrors the real-DB E2E yen() helper, which reads the authoritative JPY as the
    // text BEFORE the first ≈. Nothing the note contributes ahead of the glyph may carry
    // digits, or the indicative figure concatenates onto the yen total (regression #1209).
    const { container } = renderInProvider(<IndicativeNote jpy={27000} />, 'en')
    await waitFor(() => expect(screen.getByText(/≈ \$181/)).toBeTruthy())
    expect((container.textContent ?? '').split('≈')[0]).not.toMatch(/\d/)
  })

  it('renders nothing for a JPY display currency so the caller shows JPY alone', async () => {
    localStorage.setItem('kuruma-display-currency', 'JPY')
    const { container } = renderInProvider(<IndicativeNote jpy={27000} />, 'ja')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('renders nothing when multi-currency is gated off (#1070), even for USD', async () => {
    // Distinct from the JPY case: the display currency is USD (a conversion WOULD
    // resolve), yet the gate suppresses the note so every price shows JPY alone.
    vi.stubEnv('VITE_FEATURE_MULTI_CURRENCY', undefined)
    const { container } = renderInProvider(<IndicativeNote jpy={27000} />, 'en')
    await waitFor(() => expect(screen.queryByText(/≈/)).toBeNull())
    expect(container.textContent).toBe('')
  })

  it('renders nothing without a CurrencyProvider — degrades to JPY-only, never throws', () => {
    // IntlProvider is the app-shell root and always present; the degradation that
    // matters for #1070 is a missing CurrencyProvider (no FX rates) -> JPY alone.
    const { container } = render(
      <IntlProvider locale="en" messages={en}>
        <IndicativeNote jpy={27000} />
      </IntlProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
