import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-token', () => ({
  getApiToken: vi.fn(),
}))

vi.mock('@/modules/classes/api', () => ({
  fetchClasses: vi.fn(),
  createClass: vi.fn(),
  updateClass: vi.fn(),
  archiveClass: vi.fn(),
}))

describe('classes actions — createClassAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards token and data on success', async () => {
    const { getApiToken } = await import('@/lib/api-token')
    vi.mocked(getApiToken).mockResolvedValueOnce('tok')

    const { createClass } = await import('@/modules/classes/api')
    vi.mocked(createClass).mockResolvedValueOnce({ id: 'c1' } as never)

    const { createClassAction } = await import('@/modules/classes/actions')
    const input = { name: 'Compact', slug: 'compact' }
    const result = await createClassAction(input as never)

    expect(result).toEqual({ success: true, data: { id: 'c1' } })
    expect(createClass).toHaveBeenCalledWith(input, 'tok')
  })

  // #407 P2 (§3e): mirror the vehicle path — a 422 operator-required rejection
  // is mapped to the OPERATOR_REQUIRED code for the picker-recovery flow.
  it('maps a 422 operator-required rejection to code OPERATOR_REQUIRED', async () => {
    const { getApiToken } = await import('@/lib/api-token')
    vi.mocked(getApiToken).mockResolvedValueOnce('tok')

    const { ApiError } = await import('@/lib/api-error')
    const { createClass } = await import('@/modules/classes/api')
    vi.mocked(createClass).mockRejectedValueOnce(
      new ApiError('operatorId is required: specify a target operator', 422),
    )

    const { createClassAction } = await import('@/modules/classes/actions')
    const result = await createClassAction({ name: 'x' } as never)

    expect(result).toEqual({
      success: false,
      error: 'operatorId is required: specify a target operator',
      code: 'OPERATOR_REQUIRED',
    })
  })
})
