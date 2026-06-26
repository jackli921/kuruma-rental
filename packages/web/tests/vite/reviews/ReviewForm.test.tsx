import { ReviewForm } from '@/vite/reviews/ReviewForm'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const f = en.reviews.form

function renderForm(onSubmitted = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  render(
    <ReviewForm
      bookingId="bk-1"
      csrfToken="csrf-xyz"
      subjects={['OPERATOR', 'VEHICLE']}
      onSubmitted={onSubmitted}
    />,
    { wrapper },
  )
  return { onSubmitted }
}

// Each star is a native radio keyed by its group `name` + `${n} stars` label, so a
// rating is selected unambiguously even with several rating rows in one form.
function setStars(groupName: string, stars: number) {
  const radio = document.querySelector<HTMLInputElement>(
    `input[name="${groupName}"][aria-label="${stars} stars"]`,
  )
  if (!radio) throw new Error(`no star radio for ${groupName} = ${stars}`)
  fireEvent.click(radio)
}

function bodyOf(call: unknown): Record<string, unknown> {
  const [, init] = call as [string, { body: string }]
  return JSON.parse(init.body)
}

describe('ReviewForm', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 201,
        json: async () => ({
          success: true,
          data: {
            review: {
              id: 'r1',
              bookingId: 'bk-1',
              authorRole: 'RENTER',
              subject: 'OPERATOR',
              overall: 5,
              comment: null,
              publishedAt: null,
            },
          },
        }),
      })),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('disables submit until every pending subject has an overall rating', () => {
    renderForm()
    const submit = screen.getByRole('button', { name: f.submit })
    expect(submit).toBeDisabled()
    setStars('overall-OPERATOR', 5)
    expect(submit).toBeDisabled() // vehicle still unrated
    setStars('overall-VEHICLE', 4)
    expect(submit).toBeEnabled()
  })

  it('posts one review per subject with the rated values; operator carries sub-dimensions, vehicle does not', async () => {
    const { onSubmitted } = renderForm()
    setStars('overall-OPERATOR', 5)
    setStars('dim-OPERATOR-cleanliness', 3)
    setStars('overall-VEHICLE', 4)
    fireEvent.click(screen.getByRole('button', { name: f.submit }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const bodies = fetchMock.mock.calls.map(bodyOf)
    const operator = bodies.find((b) => b.subject === 'OPERATOR')
    const vehicle = bodies.find((b) => b.subject === 'VEHICLE')
    expect(operator).toEqual({
      bookingId: 'bk-1',
      subject: 'OPERATOR',
      overall: 5,
      subRatings: { cleanliness: 3 },
    })
    expect(vehicle).toEqual({ bookingId: 'bk-1', subject: 'VEHICLE', overall: 4 })

    // CSRF token rides on the write
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(init.headers['X-CSRF-Token']).toBe('csrf-xyz')
  })

  it('keeps the form open and surfaces an error when one subject genuinely fails', async () => {
    // OPERATOR persists, VEHICLE 500s — Promise.allSettled must not let the success
    // mask the failure: the form stays open (onSubmitted not called) with an error.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const subject = (JSON.parse(init.body) as { subject: string }).subject
        return subject === 'VEHICLE'
          ? { status: 500, json: async () => ({ success: false, error: 'boom' }) }
          : {
              status: 201,
              json: async () => ({ success: true, data: { review: { subject } } }),
            }
      }),
    )
    const { onSubmitted } = renderForm()
    setStars('overall-OPERATOR', 5)
    setStars('overall-VEHICLE', 4)
    fireEvent.click(screen.getByRole('button', { name: f.submit }))

    expect(await screen.findByText(f.error)).toBeInTheDocument()
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})
