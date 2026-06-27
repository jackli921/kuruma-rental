import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { InMemoryReviewRepository } from '../../src/repositories/in-memory/review'
import type { NewReview } from '../../src/repositories/types'
import { MAX_AGGREGATE_IDS } from '../../src/services/review-aggregate'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// #1085 slice 5 — route surface contract for the public aggregate reads.
// These tests intentionally drive the FULL app (`createApp`) rather than
// mounting the router in isolation: the P1 fix is that the wildcard
// `requireAuth('/reviews/*')` registered by `createReviewRoutes` MUST NOT
// bleed onto `GET /reviews/aggregates/*`. An anonymous request that returns
// 200 here proves the two routers don't share middleware.

const PUBLISHED = new Date('2026-06-26T00:00:00Z')
const REVEAL = new Date('2026-07-09T00:00:00Z')

let reviewRepo: InMemoryReviewRepository
let app: ReturnType<typeof createApp>

function published(overrides: Partial<NewReview> = {}): NewReview {
  return {
    bookingId: 'bk_1',
    operatorId: 'op_1',
    authorUserId: 'user_1',
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: 5,
    subRatings: {},
    comment: null,
    moderationStatus: 'VISIBLE',
    revealDeadlineAt: REVEAL,
    submittedAt: PUBLISHED,
    publishedAt: PUBLISHED,
    ...overrides,
  }
}

beforeEach(() => {
  setupAuthEnv()
  reviewRepo = new InMemoryReviewRepository()
  app = createApp({ reviewRepo })
})

describe('GET /reviews/aggregates/operators', () => {
  it('returns avg+count per id without any auth header (P1: not under requireAuth(/reviews/*))', async () => {
    await reviewRepo.insert(published({ operatorId: 'op_1', overall: 5 }))
    await reviewRepo.insert(
      published({ operatorId: 'op_1', overall: 3, bookingId: 'bk_2', authorUserId: 'u2' }),
    )
    // No Cookie / Authorization header — anonymous, like a tourist landing on /search.
    const res = await app.request('/reviews/aggregates/operators?ids=op_1,op_2')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.aggregates).toEqual({
      op_1: { avg: 4, count: 2 },
      // null (NOT {avg:0,count:0}) for an id with no published+visible reviews.
      op_2: null,
    })
  })

  it('returns 400 IDS_REQUIRED when ?ids is missing', async () => {
    const res = await app.request('/reviews/aggregates/operators')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'IDS_REQUIRED' })
  })

  it('returns 400 IDS_REQUIRED when ?ids parses to no non-empty entries', async () => {
    // Stray separators alone (",,, ") must not count as an id — the service contract
    // is "at least one id"; a trim-and-drop has to apply at the boundary.
    const res = await app.request('/reviews/aggregates/operators?ids=,,, ')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('IDS_REQUIRED')
  })

  it('returns 400 TOO_MANY_IDS when ?ids carries more than the cap (after dedupe)', async () => {
    // The cap measures unique ids (the service dedupes before checking), so we
    // need MAX_AGGREGATE_IDS + 1 UNIQUE ids to actually trip the guard.
    const ids = Array.from({ length: MAX_AGGREGATE_IDS + 1 }, (_, i) => `op_${i}`).join(',')
    const res = await app.request(`/reviews/aggregates/operators?ids=${ids}`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('TOO_MANY_IDS')
  })

  it('still serves an authenticated caller (auth is just absent, not forbidden)', async () => {
    await reviewRepo.insert(published({ operatorId: 'op_1', overall: 4 }))
    const headers = await authHeaders()
    const res = await app.request('/reviews/aggregates/operators?ids=op_1', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.aggregates.op_1).toEqual({ avg: 4, count: 1 })
  })
})

describe('GET /reviews/aggregates/vehicles', () => {
  it('keys aggregates by subjectVehicleId (anonymous)', async () => {
    await reviewRepo.insert(
      published({
        subject: 'VEHICLE',
        subjectVehicleId: 'veh_1',
        overall: 5,
      }),
    )
    await reviewRepo.insert(
      published({
        subject: 'VEHICLE',
        subjectVehicleId: 'veh_1',
        overall: 4,
        bookingId: 'bk_2',
        authorUserId: 'u2',
      }),
    )
    const res = await app.request('/reviews/aggregates/vehicles?ids=veh_1,veh_unrated')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.aggregates).toEqual({
      veh_1: { avg: 4.5, count: 2 },
      veh_unrated: null,
    })
  })

  it('returns 400 IDS_REQUIRED when ?ids is missing', async () => {
    const res = await app.request('/reviews/aggregates/vehicles')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('IDS_REQUIRED')
  })

  it('returns 400 TOO_MANY_IDS over the cap', async () => {
    const ids = Array.from({ length: MAX_AGGREGATE_IDS + 1 }, (_, i) => `veh_${i}`).join(',')
    const res = await app.request(`/reviews/aggregates/vehicles?ids=${ids}`)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('TOO_MANY_IDS')
  })
})

describe('GET /reviews/aggregates/classes', () => {
  it('keys aggregates by subjectClassId (anonymous)', async () => {
    await reviewRepo.insert(
      published({
        subject: 'CLASS',
        subjectClassId: 'cls_1',
        overall: 5,
      }),
    )
    const res = await app.request('/reviews/aggregates/classes?ids=cls_1,cls_unrated')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.aggregates).toEqual({
      cls_1: { avg: 5, count: 1 },
      cls_unrated: null,
    })
  })

  it('returns 400 IDS_REQUIRED when ?ids is missing', async () => {
    const res = await app.request('/reviews/aggregates/classes')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('IDS_REQUIRED')
  })

  it('returns 400 TOO_MANY_IDS over the cap', async () => {
    const ids = Array.from({ length: MAX_AGGREGATE_IDS + 1 }, (_, i) => `cls_${i}`).join(',')
    const res = await app.request(`/reviews/aggregates/classes?ids=${ids}`)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('TOO_MANY_IDS')
  })
})

describe('mount isolation from createReviewRoutes (P1)', () => {
  it('an anonymous GET /reviews/aggregates/operators is NOT challenged by /reviews/* auth', async () => {
    // Sanity check the failure mode this regression test guards against: if the
    // routes were ever merged back under the createReviewRoutes wildcard, this
    // anonymous request would 401 (or worse, fall through to a confusing 404).
    await reviewRepo.insert(published({ operatorId: 'op_1', overall: 4 }))
    const res = await app.request('/reviews/aggregates/operators?ids=op_1')
    expect(res.status).toBe(200)
    // For contrast: a write route under the wildcard does require auth.
    const writeRes = await app.request('/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(writeRes.status).toBe(401)
  })
})
