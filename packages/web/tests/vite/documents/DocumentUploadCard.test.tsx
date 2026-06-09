import { DocumentUploadCard } from '@/vite/documents/DocumentUploadCard'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@/vite/session', () => ({
  useSession: () => ({
    data: { user: { id: 'r1', role: 'RENTER' }, csrfToken: 'csrf-1' },
  }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    renterId: 'r1',
    type: 'IDP',
    status: 'APPROVED',
    expiryDate: null,
    verifiedAt: null,
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderCard(): ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <DocumentUploadCard />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => fetchMock.mockReset())

describe('DocumentUploadCard', () => {
  it('lists an existing approved document with its status badge', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { documents: [makeDoc()] } }))
    renderCard()

    expect(await screen.findByText('Approved')).toBeInTheDocument()
    // The label also appears as a <select> option, so scope to the list row.
    const row = screen.getByText('Approved').closest('li')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('International Driving Permit')
  })

  it('uploads the selected file with the CSRF header then shows the new pending doc', async () => {
    // First fetch: empty list. Upload POST. Refetch: a pending doc.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { documents: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { document: makeDoc({ status: 'PENDING' }) } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { documents: [makeDoc({ status: 'PENDING' })] } }),
      )

    const user = userEvent.setup()
    renderCard()

    await screen.findByText("You haven't uploaded any documents yet.")

    const file = new File(['idp-bytes'], 'idp.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Document image'), file)
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(post).toBeDefined()
    })

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'POST',
    ) as [string, RequestInit]
    expect(post[0]).toBe('/api/documents')
    expect(post[1].headers).toEqual({ 'X-CSRF-Token': 'csrf-1' })
    const body = post[1].body as FormData
    expect(body.get('type')).toBe('IDP')
    expect(body.get('file')).toBe(file)

    expect(await screen.findByText('Pending review')).toBeInTheDocument()
  })
})
