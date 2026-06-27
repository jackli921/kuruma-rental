import { ConsentGate } from '@/vite/consent/ConsentGate'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockUseSession, mockFetchStatus, mockAccept } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockFetchStatus: vi.fn(),
  mockAccept: vi.fn(),
}))
vi.mock('@/vite/session', () => ({ useSession: mockUseSession }))
vi.mock('@/vite/consent/api', () => ({
  fetchConsentStatus: mockFetchStatus,
  acceptConsent: mockAccept,
}))

const pending = [
  {
    type: 'RENTER_TOS',
    document: {
      id: 'doc_tos_v1_en',
      title: 'Terms of Service',
      body: 'The terms body.',
      acceptanceLabel: 'I accept the Terms of Service',
    },
  },
  {
    type: 'PRIVACY_POLICY',
    document: {
      id: 'doc_priv_v1_en',
      title: 'Privacy Policy',
      body: 'The privacy body.',
      acceptanceLabel: 'I accept the Privacy Policy',
    },
  },
]

function sessionFor(role: string) {
  return { data: { user: { id: 'r1', role }, csrfToken: 'csrf-1' } }
}

function renderGate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <ConsentGate locale="en">
          <div>protected renter content</div>
        </ConsentGate>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  mockUseSession.mockReset()
  mockFetchStatus.mockReset()
  mockAccept.mockReset()
})

describe('ConsentGate (Flow A clickwrap, #877)', () => {
  it('blocks a renter who owes consent, showing each document and hiding the page', async () => {
    mockUseSession.mockReturnValue(sessionFor('RENTER'))
    mockFetchStatus.mockResolvedValue(pending)
    renderGate()

    expect(await screen.findByText('Terms of Service')).toBeInTheDocument()
    expect(screen.getByText('The privacy body.')).toBeInTheDocument()
    expect(screen.getByText('I accept the Privacy Policy')).toBeInTheDocument()
    // The protected page must not render behind the gate.
    expect(screen.queryByText('protected renter content')).not.toBeInTheDocument()
  })

  it('keeps the accept button disabled until every document is checked', async () => {
    mockUseSession.mockReturnValue(sessionFor('RENTER'))
    mockFetchStatus.mockResolvedValue(pending)
    renderGate()

    const accept = await screen.findByRole('button', { name: 'Accept and continue' })
    expect(accept).toBeDisabled()

    const boxes = screen.getAllByRole('checkbox')
    await userEvent.click(boxes[0] as HTMLElement)
    expect(accept).toBeDisabled()

    await userEvent.click(boxes[1] as HTMLElement)
    expect(accept).toBeEnabled()
  })

  it('accepts every document then reveals the page once the renter is current', async () => {
    mockUseSession.mockReturnValue(sessionFor('RENTER'))
    mockFetchStatus.mockResolvedValueOnce(pending).mockResolvedValue([])
    mockAccept.mockResolvedValue(undefined)
    renderGate()

    const boxes = await screen.findAllByRole('checkbox')
    await userEvent.click(boxes[0] as HTMLElement)
    await userEvent.click(boxes[1] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Accept and continue' }))

    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledWith('doc_tos_v1_en', 'csrf-1')
      expect(mockAccept).toHaveBeenCalledWith('doc_priv_v1_en', 'csrf-1')
    })
    expect(await screen.findByText('protected renter content')).toBeInTheDocument()
  })

  it('renders the page untouched when the renter owes nothing', async () => {
    mockUseSession.mockReturnValue(sessionFor('RENTER'))
    mockFetchStatus.mockResolvedValue([])
    renderGate()

    expect(await screen.findByText('protected renter content')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('never gates a non-renter and never queries consent for them', async () => {
    mockUseSession.mockReturnValue(sessionFor('OPERATOR_OWNER'))
    mockFetchStatus.mockResolvedValue(pending)
    renderGate()

    expect(await screen.findByText('protected renter content')).toBeInTheDocument()
    expect(mockFetchStatus).not.toHaveBeenCalled()
  })
})
