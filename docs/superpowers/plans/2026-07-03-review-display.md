# Review Display (Read Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render individual published reviews (stars + comment + sub-dimensions) on the storefront detail page, closing the last gap in epic #1067 — the feature can be submitted and aggregated but never *read*.

**Architecture:** Pure read-side vertical slice on the existing `reviews` table (no migration). A new repository method returns published + VISIBLE reviews for one subject; a new `ReviewListService` maps rows to a privacy-curated `PublicReview` wire shape (no `bookingId`/`authorUserId`); a new public route mirrors the existing `createReviewAggregateRoutes` pattern (anonymous, IP-rate-limited); the web renders a flag-gated `ReviewList` on `StorefrontDetailView`.

**Tech Stack:** Hono + Drizzle (neon-http) on CF Workers (api), Vite + TanStack Router + TanStack Query + use-intl (web), Zod (shared validators), Vitest (unit/integration), the repo's InMemory-vs-Drizzle DI split.

---

## Scope & Decisions (locked)

- **Subject:** operator reviews only, on `StorefrontDetailView`. Vehicle-level lists = follow-up.
- **Reviewer identity:** anonymous ("Verified renter" + date). Honors the epic non-goal "no public renter profiles"; avoids a `users` join + PII surface. First-name = future enhancement.
- **Pagination:** MVP shows the newest `MAX_REVIEW_LIST = 20` published reviews, no "load more" (follow-up).
- **Privacy:** the service allow-lists `OPERATOR`/`VEHICLE` subjects only — never `RENTER` (operator→renter reviews stay private). The wire shape omits `bookingId`, `authorUserId`, `operatorId`, `moderationStatus`, `revealDeadlineAt`, `submittedAt`.
- **Visibility:** only `publishedAt IS NOT NULL AND moderationStatus = 'VISIBLE'` rows surface — same predicate the aggregates already use, so a hidden or still-double-blind review never appears.
- **Feature flag:** the whole section renders only when `useFeatureFlag('REVIEWS')` is on (matches `RatingBadge`). **No migration, no schema change.**

## File Structure

**api (`packages/api`)**
- Modify `src/repositories/types.ts` — add `listPublishedForSubject` to `ReviewRepository` (the port lives in `types-review.ts`, re-exported by `types.ts`; edit `types-review.ts`).
- Modify `src/repositories/in-memory/review.ts` — implement it.
- Modify `src/repositories/drizzle/review.ts` — implement it.
- Create `src/services/review-list.ts` — `ReviewListService` + `PublicReview` + `MAX_REVIEW_LIST`.
- Create `src/routes/review-list.ts` — `createReviewListRoutes` (public, rate-limited).
- Modify `src/index.ts` — construct the service, mount the router.

**web (`packages/web`)**
- Modify `src/vite/reviews/api.ts` — `PublicReviewDto`, `fetchOperatorReviews`, `operatorReviewsQueryOptions`.
- Create `src/vite/reviews/StarDisplay.tsx` — readonly filled-star row.
- Create `src/vite/reviews/ReviewList.tsx` — renders the list (flag-gated, empty state).
- Modify `src/vite/reviews/index.ts` — barrel export `ReviewList`, `operatorReviewsQueryOptions`, `type PublicReviewDto`.
- Modify `src/vite/storefronts/StorefrontDetailView.tsx` — render `<ReviewList>` under the vehicles.
- Modify `messages/{en,ja,zh}.json` — add `reviews.list.*`.

**tests**
- Modify `packages/api/tests/repositories/review.test.ts` — InMemory `listPublishedForSubject`.
- Create `packages/api/tests/integration/review-list.test.ts` — real-pg Drizzle.
- Create `packages/api/src/services/review-list.test.ts` — service mapping/allow-list/cap.
- Create `packages/api/tests/routes/review-list.test.ts` — route wire.
- Modify `packages/web/src/vite/reviews/api.test.ts` — fetch/parse.
- Create `packages/web/src/vite/reviews/ReviewList.test.tsx` — render + flag gating.
- Modify the `StorefrontDetailView` test (find it under `packages/web/tests/vite/storefronts/`) — section renders when flag on.

---

## Task 1: Repository port + InMemory `listPublishedForSubject`

**Files:**
- Modify: `packages/api/src/repositories/types-review.ts`
- Modify: `packages/api/src/repositories/in-memory/review.ts`
- Test: `packages/api/tests/repositories/review.test.ts`

- [ ] **Step 1: Add the port method to the interface**

In `packages/api/src/repositories/types-review.ts`, inside `interface ReviewRepository` (after `aggregateByClass`), add:

```ts
  // Public display read (review-display slice). The newest published + VISIBLE
  // reviews whose subject key matches, capped at `limit`, ordered publishedAt DESC.
  // subject='OPERATOR' scopes on the denormalized operatorId; 'VEHICLE' on
  // subjectVehicleId. RENTER is never listable (privacy) — the service enforces that,
  // so this port only accepts the two public subjects.
  listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
  ): Promise<Review[]>
```

- [ ] **Step 2: Write the failing InMemory test**

In `packages/api/tests/repositories/review.test.ts`, add (adapt the `makeReview`/factory helper already used in that file — reuse its existing builder; if it builds rows via `repo.insert`, insert rows with explicit `publishedAt`/`moderationStatus` via the store seam that file already uses):

```ts
describe('listPublishedForSubject', () => {
  it('returns only published + VISIBLE operator reviews, newest first, capped', async () => {
    const store = new Map<string, Review>()
    const repo = new InMemoryReviewRepository(store)
    const base = {
      operatorId: 'op1', authorRole: 'RENTER' as const, subject: 'OPERATOR' as const,
      subjectVehicleId: null, subjectClassId: null, subRatings: {}, comment: 'ok',
      moderationStatus: 'VISIBLE' as const, revealDeadlineAt: new Date('2026-01-01'),
      submittedAt: new Date('2026-01-01'),
    }
    const seed = (id: string, over: Partial<Review>) =>
      store.set(id, { ...base, id, bookingId: id, overall: 5, createdAt: new Date(), updatedAt: new Date(), publishedAt: new Date('2026-06-01'), ...over } as Review)
    seed('r-old', { publishedAt: new Date('2026-06-01') })
    seed('r-new', { publishedAt: new Date('2026-06-03') })
    seed('r-hidden', { moderationStatus: 'HIDDEN' })
    seed('r-unrevealed', { publishedAt: null })
    seed('r-otherop', { operatorId: 'op2' })
    seed('r-vehicle', { subject: 'VEHICLE', subjectVehicleId: 'v1' })

    const result = await repo.listPublishedForSubject('OPERATOR', 'op1', 20)

    expect(result.map((r) => r.id)).toEqual(['r-new', 'r-old'])
  })

  it('respects the limit', async () => {
    const store = new Map<string, Review>()
    const repo = new InMemoryReviewRepository(store)
    for (let i = 0; i < 5; i++) {
      store.set(`r${i}`, {
        id: `r${i}`, bookingId: `b${i}`, operatorId: 'op1', authorUserId: 'u', authorRole: 'RENTER',
        subject: 'OPERATOR', subjectVehicleId: null, subjectClassId: null, overall: 4, subRatings: {},
        comment: null, moderationStatus: 'VISIBLE', revealDeadlineAt: new Date(),
        submittedAt: new Date(), publishedAt: new Date(2026, 5, i + 1), createdAt: new Date(), updatedAt: new Date(),
      })
    }
    const result = await repo.listPublishedForSubject('OPERATOR', 'op1', 2)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual(['r4', 'r3'])
  })
})
```

> **Prefer the file's factory (verified).** `review.test.ts` builds rows via a `renterReview(): NewReview` factory + `repo.insert(...)`, not direct `store.set`. Rewrite the seeding as `await repo.insert(renterReview({ bookingId: <distinct>, subject: 'OPERATOR', publishedAt: <date>, moderationStatus }))` — the `(bookingId, subject)` seal permits multiple rows across DISTINCT bookingIds. If you keep direct `store.set` seeding instead, add `authorUserId` to `base` and drop the `as Review` cast (the cast silently masks the missing field).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display && ./node_modules/.bin/vitest run packages/api/tests/repositories/review.test.ts -t listPublishedForSubject`
Expected: FAIL — `repo.listPublishedForSubject is not a function`.

- [ ] **Step 4: Implement in InMemory repo**

In `packages/api/src/repositories/in-memory/review.ts`, add a method (after `findRevealDue`):

```ts
  async listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
  ): Promise<Review[]> {
    const keyOf = (r: Review) => (subject === 'OPERATOR' ? r.operatorId : r.subjectVehicleId)
    return [...this.store.values()]
      .filter(
        (r) =>
          r.subject === subject &&
          r.publishedAt !== null &&
          r.moderationStatus === 'VISIBLE' &&
          keyOf(r) === subjectId,
      )
      .sort((a, b) => {
        // Newest-first, with an id tiebreak: the reveal sweep stamps a whole batch with
        // ONE identical publishedAt, so date alone is an unstable order (and the keyset
        // pagination follow-up needs a unique tiebreak anyway). Mirror the Drizzle
        // orderBy(desc(publishedAt), desc(id)).
        const byDate = (b.publishedAt as Date).getTime() - (a.publishedAt as Date).getTime()
        return byDate !== 0 ? byDate : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      })
      .slice(0, limit)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run packages/api/tests/repositories/review.test.ts -t listPublishedForSubject`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/types-review.ts packages/api/src/repositories/in-memory/review.ts packages/api/tests/repositories/review.test.ts
git commit -m "feat(#1067): review-list repo port + InMemory listPublishedForSubject"
```

---

## Task 2: Drizzle `listPublishedForSubject` + real-pg integration test

**Files:**
- Modify: `packages/api/src/repositories/drizzle/review.ts`
- Test: `packages/api/tests/integration/review-list.test.ts` (create)

- [ ] **Step 1: Write the failing integration test**

Create `packages/api/tests/integration/review-list.test.ts` (mirror the header of `review-aggregates.test.ts` — the `(bookingId, subject)` UNIQUE seal means each booking yields at most one OPERATOR review, so two operator reviews need two bookings):

```ts
import { reviews } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleReviewRepository } from '../../src/repositories/drizzle/review'
import { type SeededBooking, createSeededBooking } from './booking-factory'
import { db } from './setup'

let a: SeededBooking
let b: SeededBooking
const repo = new DrizzleReviewRepository(db)

beforeAll(async () => {
  a = await createSeededBooking({ prefix: 'review-list' })
  b = await createSeededBooking({ prefix: 'review-list-2' })
})

afterEach(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, [a.booking.id, b.booking.id]))
})

afterAll(async () => {
  await db.delete(reviews).where(inArray(reviews.bookingId, [a.booking.id, b.booking.id]))
})

async function insertOperatorReview(
  booking: SeededBooking,
  over: { publishedAt: Date | null; moderationStatus?: 'VISIBLE' | 'HIDDEN'; overall?: number },
) {
  return repo.insert({
    bookingId: booking.booking.id,
    operatorId: booking.operatorId,
    authorUserId: booking.renterId,
    authorRole: 'RENTER',
    subject: 'OPERATOR',
    subjectVehicleId: null,
    subjectClassId: null,
    overall: over.overall ?? 5,
    subRatings: {},
    comment: 'great',
    moderationStatus: over.moderationStatus ?? 'VISIBLE',
    revealDeadlineAt: new Date('2026-01-01'),
    submittedAt: new Date('2026-01-01'),
    publishedAt: over.publishedAt,
  })
}

describe('DrizzleReviewRepository.listPublishedForSubject (real pg)', () => {
  it('returns published+visible operator reviews newest-first and drops hidden/unrevealed', async () => {
    await insertOperatorReview(a, { publishedAt: new Date('2026-06-01') })
    await insertOperatorReview(b, { publishedAt: new Date('2026-06-05') })
    // a hidden + an unrevealed row on fresh bookings so the unique seal isn't hit
    const c = await createSeededBooking({ prefix: 'review-list-3' })
    await repo.insert({
      bookingId: c.booking.id, operatorId: a.operatorId, authorUserId: c.renterId, authorRole: 'RENTER',
      subject: 'OPERATOR', subjectVehicleId: null, subjectClassId: null, overall: 1, subRatings: {},
      comment: 'hidden', moderationStatus: 'HIDDEN', revealDeadlineAt: new Date('2026-01-01'),
      submittedAt: new Date('2026-01-01'), publishedAt: new Date('2026-06-09'),
    })

    const result = await repo.listPublishedForSubject('OPERATOR', a.operatorId, 20)

    // Scope the assertion to OUR seeded bookings. listPublishedForSubject scans EVERY
    // published+visible OPERATOR review for the (denormalized) operator, and a and b
    // share the booking-factory default operator; a concurrently-running integration
    // file (e.g. review-aggregates) may insert rows for that SAME operator. So assert
    // relative order + membership of a/b, and exclusion of the hidden c — never a
    // full-scan toEqual. (See the Learn note at the end of this plan.)
    const ours = result
      .map((r) => r.bookingId)
      .filter((id) => [a.booking.id, b.booking.id, c.booking.id].includes(id))
    expect(ours).toEqual([b.booking.id, a.booking.id])
    expect(result.map((r) => r.bookingId)).not.toContain(c.booking.id)
    await db.delete(reviews).where(inArray(reviews.bookingId, [c.booking.id]))
  })
})
```

> Verified: `createSeededBooking` returns `{ booking, operatorId, renterId, ids, cleanup }` and two default bookings share the operator (`booking-factory.ts:143-146,170`). The `limit` cap is DB-agnostic (`.limit(n)`) and is proven deterministically by the InMemory "respects the limit" case in Task 1 — NOT re-proven here, because a `limit 1` assertion over a shared-operator scan is inherently flaky under concurrent inserts. This integration test's job is to pin the Drizzle predicate + ordering on real Postgres.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display && bun run --filter @kuruma/api test:integration review-list`
Expected: FAIL — `repo.listPublishedForSubject is not a function`.

- [ ] **Step 3: Implement in Drizzle repo**

In `packages/api/src/repositories/drizzle/review.ts`: add `desc` to the `drizzle-orm` import, then add (after `findRevealDue`):

```ts
  async listPublishedForSubject(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    limit: number,
  ): Promise<Review[]> {
    // Same published+visible predicate as the aggregate scan, but returns whole rows
    // ordered newest-first for the public review list. subject='OPERATOR' keys on the
    // denormalized operatorId (idx_reviews_operator_published covers the filter+order);
    // 'VEHICLE' keys on subjectVehicleId.
    const key = subject === 'OPERATOR' ? reviews.operatorId : reviews.subjectVehicleId
    const rows = await this.db
      .select(reviewColumns)
      .from(reviews)
      .where(
        and(
          eq(reviews.subject, subject),
          eq(key, subjectId),
          isNotNull(reviews.publishedAt),
          eq(reviews.moderationStatus, 'VISIBLE'),
        ),
      )
      // desc(id) tiebreak: the reveal sweep stamps a batch with one identical
      // publishedAt, so date alone is an unstable order (and keyset pagination later
      // needs a unique tiebreak). Mirrors the InMemory sort.
      .orderBy(desc(reviews.publishedAt), desc(reviews.id))
      .limit(limit)
    return rows.map(toReview)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test:integration review-list`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/drizzle/review.ts packages/api/tests/integration/review-list.test.ts
git commit -m "feat(#1067): Drizzle listPublishedForSubject + real-pg integration test"
```

---

## Task 3: `ReviewListService`

**Files:**
- Create: `packages/api/src/services/review-list.ts`
- Test: `packages/api/src/services/review-list.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/api/src/services/review-list.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Review } from '../stores'
import type { ReviewRepository } from '../repositories/types'
import { MAX_REVIEW_LIST, ReviewListService } from './review-list'

function review(over: Partial<Review>): Review {
  return {
    id: 'r1', bookingId: 'b1', operatorId: 'op1', authorUserId: 'u1', authorRole: 'RENTER',
    subject: 'OPERATOR', subjectVehicleId: null, subjectClassId: null, overall: 5,
    subRatings: { cleanliness: 5 }, comment: 'great', moderationStatus: 'VISIBLE',
    revealDeadlineAt: new Date('2026-01-01'), submittedAt: new Date('2026-01-01'),
    publishedAt: new Date('2026-06-02T03:00:00.000Z'), createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }
}

function repoWith(list: Review[]): ReviewRepository {
  return { listPublishedForSubject: vi.fn().mockResolvedValue(list) } as unknown as ReviewRepository
}

describe('ReviewListService.forOperator', () => {
  it('maps rows to the privacy-curated PublicReview shape (no bookingId/authorUserId)', async () => {
    const svc = new ReviewListService(repoWith([review({})]))
    const result = await svc.forOperator('op1')
    expect(result).toEqual([
      { id: 'r1', overall: 5, subRatings: { cleanliness: 5 }, comment: 'great', publishedAt: '2026-06-02T03:00:00.000Z' },
    ])
    expect(result[0]).not.toHaveProperty('bookingId')
    expect(result[0]).not.toHaveProperty('authorUserId')
  })

  it('asks the repo for OPERATOR subject, capped at MAX_REVIEW_LIST', async () => {
    const repo = repoWith([])
    const svc = new ReviewListService(repo)
    await svc.forOperator('op9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith('OPERATOR', 'op9', MAX_REVIEW_LIST)
  })

  it('forVehicle asks for VEHICLE subject', async () => {
    const repo = repoWith([])
    await new ReviewListService(repo).forVehicle('v9')
    expect(repo.listPublishedForSubject).toHaveBeenCalledWith('VEHICLE', 'v9', MAX_REVIEW_LIST)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display && ./node_modules/.bin/vitest run packages/api/src/services/review-list.test.ts`
Expected: FAIL — cannot find module `./review-list`.

- [ ] **Step 3: Implement the service**

Create `packages/api/src/services/review-list.ts`:

```ts
import type { Review } from '../stores'
import type { ReviewRepository } from '../repositories/types'

/**
 * Public review-list read service (review-display slice, #1067). Returns the newest
 * published + VISIBLE reviews for one subject, curated to a privacy-safe wire shape.
 * Public — no authz; callers are anonymous storefront pages (mirrors ReviewAggregateService).
 *
 * Only OPERATOR / VEHICLE subjects are listable: an operator's review OF a renter
 * (subject='RENTER') stays private, so this service never exposes one.
 */

/** The public wire shape. Deliberately omits bookingId / authorUserId / operatorId /
 *  moderationStatus / reveal timestamps — a storefront reader needs only the content. */
export interface PublicReview {
  readonly id: string
  readonly overall: number
  readonly subRatings: Record<string, number>
  readonly comment: string | null
  /** ISO 8601 (UTC). Non-null — the repo only returns published rows. */
  readonly publishedAt: string
}

/** Newest-N shown without pagination; "load more" is a follow-up. Mirrors the search
 *  page size so a busy operator's list stays bounded. */
export const MAX_REVIEW_LIST = 20

export class ReviewListService {
  constructor(private readonly reviewRepo: ReviewRepository) {}

  forOperator(operatorId: string): Promise<PublicReview[]> {
    return this.list('OPERATOR', operatorId)
  }

  forVehicle(vehicleId: string): Promise<PublicReview[]> {
    return this.list('VEHICLE', vehicleId)
  }

  private async list(subject: 'OPERATOR' | 'VEHICLE', subjectId: string): Promise<PublicReview[]> {
    const rows = await this.reviewRepo.listPublishedForSubject(subject, subjectId, MAX_REVIEW_LIST)
    return rows.map(toPublicReview)
  }
}

function toPublicReview(r: Review): PublicReview {
  // publishedAt is non-null by the repo contract (published rows only); the ?? guards
  // the type without inventing a date.
  return {
    id: r.id,
    overall: r.overall,
    subRatings: r.subRatings,
    comment: r.comment,
    publishedAt: (r.publishedAt ?? new Date(0)).toISOString(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run packages/api/src/services/review-list.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/review-list.ts packages/api/src/services/review-list.test.ts
git commit -m "feat(#1067): ReviewListService maps rows to privacy-curated PublicReview"
```

---

## Task 4: Public route + DI wiring

**Files:**
- Create: `packages/api/src/routes/review-list.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/tests/routes/review-list.test.ts` (create)

- [ ] **Step 1: Write the failing route test**

Create `packages/api/tests/routes/review-list.test.ts` (mirror the harness in `tests/routes/review-aggregates.test.ts` — reuse its app-building helper if present; otherwise build a Hono app from `createReviewListRoutes` with a stub service):

```ts
import { describe, expect, it } from 'vitest'
import { createReviewListRoutes } from '../../src/routes/review-list'
import type { ReviewListService, PublicReview } from '../../src/services/review-list'

function appWith(reviews: PublicReview[]) {
  const service = {
    forOperator: async () => reviews,
    forVehicle: async () => reviews,
  } as unknown as ReviewListService
  return createReviewListRoutes(service)
}

const sample: PublicReview = {
  id: 'r1', overall: 5, subRatings: { cleanliness: 5 }, comment: 'great', publishedAt: '2026-06-02T03:00:00.000Z',
}

describe('GET /reviews/for/operators/:id', () => {
  it('returns the published reviews for the operator', async () => {
    const res = await appWith([sample]).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [sample] } })
  })

  it('returns an empty list (200) when the operator has none', async () => {
    const res = await appWith([]).request('/reviews/for/operators/op1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { reviews: [] } })
  })
})
```

> **Envelope (verified):** `ok(c, { reviews })` emits `{ success: true, data: { reviews }, ...extras }` (`routes/helpers.ts:9-16`) — the payload is nested under `data`. The assertion above matches; the sibling aggregate test pins the same shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display && ./node_modules/.bin/vitest run packages/api/tests/routes/review-list.test.ts`
Expected: FAIL — cannot find module `../../src/routes/review-list`.

- [ ] **Step 3: Implement the route**

Create `packages/api/src/routes/review-list.ts` (model on `review-aggregates.ts` — public, same rate limiter, separate router so the `/reviews/*` auth guard doesn't bleed):

```ts
import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import type { ReviewListService } from '../services/review-list'
import { ok } from './helpers'
import { rateLimitByIp } from './rate-limit'

/**
 * Public review-list read surface (review-display slice, #1067). The newest published
 * reviews for a storefront's operator (and, later, a vehicle). Anonymous, like the
 * aggregate reads — mounted in a SEPARATE Hono router from createReviewRoutes so the
 * `requireAuth('/reviews/:id')` there does not gate these GETs.
 */
export function createReviewListRoutes(
  service: ReviewListService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Same per-IP budget as the rest of the public catalog — review text is as
  // scrape-prone as the aggregates and storefront cards. Fails closed on an
  // unresolvable IP (#580).
  if (publicCatalogLimiter) {
    app.use('/reviews/for/*', rateLimitByIp(publicCatalogLimiter))
  }

  return app
    .get('/reviews/for/operators/:id', async (c) => {
      const reviews = await service.forOperator(c.req.param('id'))
      return ok(c, { reviews })
    })
    .get('/reviews/for/vehicles/:id', async (c) => {
      const reviews = await service.forVehicle(c.req.param('id'))
      return ok(c, { reviews })
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run packages/api/tests/routes/review-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the composition root**

In `packages/api/src/index.ts`:
1. Add import near the other review route imports (~line 64):
```ts
import { createReviewListRoutes } from './routes/review-list'
```
2. Add import near the other review service imports (~line 122):
```ts
import { ReviewListService } from './services/review-list'
```
3. After `const reviewAggregateService = new ReviewAggregateService(reviewRepo)` (~line 519):
```ts
  const reviewListService = new ReviewListService(reviewRepo)
```
4. After the `.route('/', createReviewAggregateRoutes(reviewAggregateService, publicCatalogLimiter))` line (~line 575):
```ts
    .route('/', createReviewListRoutes(reviewListService, publicCatalogLimiter))
```

- [ ] **Step 6: Verify api typecheck + boundaries**

Run: `cd ~/Dev/kuruma-1067-review-display && bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api lint:boundaries`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/review-list.ts packages/api/src/index.ts packages/api/tests/routes/review-list.test.ts
git commit -m "feat(#1067): public GET /reviews/for/operators/:id route + DI wiring"
```

---

## Task 5: Web api client (`PublicReviewDto`, fetch, queryOptions)

**Files:**
- Modify: `packages/web/src/vite/reviews/api.ts`
- Test: `packages/web/src/vite/reviews/api.test.ts`

- [ ] **Step 1: Write the failing parse test**

In `packages/web/src/vite/reviews/api.test.ts`, add (match the existing mock-fetch style in that file):

```ts
describe('fetchOperatorReviews', () => {
  it('parses the published-review list from the {data:{reviews}} envelope', async () => {
    const reviews = [
      { id: 'r1', overall: 5, subRatings: { cleanliness: 5 }, comment: 'great', publishedAt: '2026-06-02T03:00:00.000Z' },
    ]
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { reviews } }))
    const result = await fetchOperatorReviews('op1')
    expect(result).toEqual(reviews)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/reviews/for/operators/op1')
  })

  it('throws when a field is dropped (seam parse)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { reviews: [{ id: 'r1' }] } }))
    await expect(fetchOperatorReviews('op1')).rejects.toThrow()
  })
})
```

> **Use the file's existing harness, not `vi.stubGlobal`.** `api.test.ts` already defines a module-level `fetchMock` and a `jsonResponse(body)` helper and mocks `getApiBaseUrl` to `/api` (see its top-of-file setup + the aggregate tests). Reuse both verbatim. The envelope is `{ success: true, data: { reviews } }` — `unwrap` reads `body.data` (`lib/api-error.ts:60-79`); a bare `{ success: true, reviews }` would fail parse for the WRONG reason. The URL assertion pins the endpoint path (the base is mocked to `/api`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display/packages/web && ../../node_modules/.bin/vitest run src/vite/reviews/api.test.ts -t fetchOperatorReviews`
Expected: FAIL — `fetchOperatorReviews is not exported`.

- [ ] **Step 3: Implement the client**

In `packages/web/src/vite/reviews/api.ts`, after the `ReviewDto` block (~line 56), add:

```ts
// Public review-list wire shape (review-display slice). Mirrors the api PublicReview —
// curated: no bookingId/authorUserId. subRatings is the dimension→stars map ({} when none).
export interface PublicReviewDto {
  id: string
  overall: number
  subRatings: Record<string, number>
  comment: string | null
  publishedAt: string
}

const publicReviewDtoSchema = z.object({
  id: z.string(),
  overall: z.number(),
  subRatings: z.record(z.string(), z.number()),
  comment: z.string().nullable(),
  publishedAt: z.string(),
}) satisfies z.ZodType<PublicReviewDto>

// GET /reviews/for/operators/:id — public, anonymous (no credentials needed).
export async function fetchOperatorReviews(operatorId: string): Promise<PublicReviewDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/reviews/for/operators/${encodeURIComponent(operatorId)}`)
  const { reviews } = await unwrap(res, z.object({ reviews: z.array(publicReviewDtoSchema) }))
  return reviews
}

export function operatorReviewsQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: ['reviews', 'list', 'operators', operatorId],
    queryFn: () => fetchOperatorReviews(operatorId),
  })
}
```

> `queryOptions`, `z`, `unwrap`, `getApiBaseUrl` are already imported at the top of `api.ts` (used by the aggregate/booking readers). Confirm and don't re-import.
>
> **`satisfies` caveat (MINOR):** `... satisfies z.ZodType<PublicReviewDto>` on a schema whose `subRatings` is `z.record(z.string(), z.number())` may not typecheck — Zod can infer the record as `Partial<Record<string, number>>`, clashing with the interface's `Record<string, number>`. The sibling aggregate reader puts `satisfies` only on the LEAF `aggregateEntrySchema`, not the record-bearing response schema (`api.ts:153-160`). If tsc errors on the record, follow that precedent: drop `satisfies` from `publicReviewDtoSchema` and instead assert the leaf, or type `subRatings` as `z.record(z.string(), z.number())` and let the `fetchOperatorReviews` return type (`PublicReviewDto[]`) be the contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `../../node_modules/.bin/vitest run src/vite/reviews/api.test.ts -t fetchOperatorReviews`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/kuruma-1067-review-display
git add packages/web/src/vite/reviews/api.ts packages/web/src/vite/reviews/api.test.ts
git commit -m "feat(#1067): web fetchOperatorReviews + PublicReviewDto parse"
```

---

## Task 6: `StarDisplay` + `ReviewList` components

**Files:**
- Create: `packages/web/src/vite/reviews/StarDisplay.tsx`
- Create: `packages/web/src/vite/reviews/ReviewList.tsx`
- Test: `packages/web/src/vite/reviews/ReviewList.test.tsx` (create)

- [ ] **Step 1: Write the failing component test**

Create `packages/web/src/vite/reviews/ReviewList.test.tsx` (match the render harness used by `RatingBadge.test.tsx` / `ReviewForm.test.tsx` — the verified harness is shown below):

Use the SAME harness as `RatingBadge.test.tsx` (verified): render inside `<IntlProvider locale="en" messages={en}>` and toggle the flag with `vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')`. `useFeatureFlag` falls back to the build-time env default (off) outside `FeatureFlagsProvider`, so no provider is needed; `ReviewList` takes `reviews` as a prop and fires no query, so `IntlProvider` alone suffices (no `QueryClientProvider`).

```tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { PublicReviewDto } from '@/vite/reviews/api'
import { ReviewList } from '@/vite/reviews/ReviewList'

const sample: PublicReviewDto[] = [
  { id: 'r1', overall: 5, subRatings: { cleanliness: 4 }, comment: 'Spotless car', publishedAt: '2026-06-02T03:00:00.000Z' },
]

function renderList(reviews: PublicReviewDto[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ReviewList reviews={reviews} />
    </IntlProvider>,
  )
}

afterEach(() => vi.unstubAllEnvs())

describe('ReviewList', () => {
  it('renders nothing when the REVIEWS flag is off (default, no stub)', () => {
    const { container } = renderList(sample)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the comment and an overall star label when the flag is on', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList(sample)
    expect(screen.getByText('Spotless car')).toBeInTheDocument()
    // StarDisplay renders role="img" with aria-label = reviews.list.overallAria.
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no reviews', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList([])
    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
  })
})
```

> Inspect `RatingBadge.test.tsx` for the ACTUAL provider/flag-mock helper name and import path, and use it verbatim — the `IntlProvider` + `vi.stubEnv('VITE_FEATURE_REVIEWS', ...)` harness above is the verified real pattern from `RatingBadge.test.tsx` (there is NO `renderWithProviders` helper) — mirror its exact relative import of `en`. The `reviews.list.*` English copy the assertions read (`No reviews yet`, `5 out of 5 stars`) must exist first (Task 7 Step 1); add it before running this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display/packages/web && ../../node_modules/.bin/vitest run src/vite/reviews/ReviewList.test.tsx`
Expected: FAIL — cannot resolve `@/vite/reviews/ReviewList`.

- [ ] **Step 3: Implement `StarDisplay`**

Create `packages/web/src/vite/reviews/StarDisplay.tsx`:

```tsx
import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'

const STARS = [1, 2, 3, 4, 5] as const

interface StarDisplayProps {
  /** 1-5 whole stars. */
  readonly value: number
  /** Accessible name for the row, e.g. "5 out of 5 stars". */
  readonly label: string
}

// Readonly star row (review-display slice) — the input counterpart is StarRating.
// A single labelled group; individual stars are aria-hidden decoration.
export function StarDisplay({ value, label }: StarDisplayProps) {
  return (
    <div className="flex gap-0.5" role="img" aria-label={label}>
      {STARS.map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn('size-4', n <= value ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40')}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Implement `ReviewList`**

Create `packages/web/src/vite/reviews/ReviewList.tsx`:

```tsx
import { useFeatureFlag } from '@/vite/config'
import type { PublicReviewDto } from '@/vite/reviews/api'
import { StarDisplay } from '@/vite/reviews/StarDisplay'
import { useFormatter, useTranslations } from 'use-intl'

interface ReviewListProps {
  readonly reviews: readonly PublicReviewDto[]
}

// Public review list (review-display slice, #1067). Flag-gated like RatingBadge so no
// review text surfaces until reviews go live. Reviewer identity is intentionally
// anonymous ("Verified renter") — the epic non-goal forbids public renter profiles.
export function ReviewList({ reviews }: ReviewListProps) {
  const t = useTranslations('reviews.list')
  const tDim = useTranslations('reviews.form.dimension')
  const format = useFormatter()
  const reviewsEnabled = useFeatureFlag('REVIEWS')

  if (!reviewsEnabled) return null

  return (
    <section aria-labelledby="reviews-heading" className="mt-12">
      <h2 id="reviews-heading" className="mb-4 text-xl font-semibold tracking-tight">
        {t('heading')}
      </h2>
      {reviews.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-6">
          {reviews.map((r) => (
            <li key={r.id} className="border-b pb-6 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <StarDisplay value={r.overall} label={t('overallAria', { n: r.overall })} />
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(r.publishedAt), { year: 'numeric', month: 'short' })}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{t('reviewer')}</p>
              {r.comment ? <p className="mt-2 whitespace-pre-line">{r.comment}</p> : null}
              {Object.keys(r.subRatings).length > 0 ? (
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {Object.entries(r.subRatings).map(([dim, stars]) => (
                    <div key={dim} className="flex items-center gap-2">
                      <dt className="text-muted-foreground">{tDim(dim)}</dt>
                      <dd>{t('dimensionValue', { n: stars })}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

> `tDim(dim)` reuses the existing `reviews.form.dimension.*` keys. If a sub-dimension key can be absent there (e.g. `ruleAdherence` is under `operatorPanel.dimension`), operator-subject reviews only ever carry `cleanliness/accuracy/communication/value`, all present under `form.dimension` — safe. Confirm during implementation.

- [ ] **Step 5: Run test to verify it passes**

Run: `../../node_modules/.bin/vitest run src/vite/reviews/ReviewList.test.tsx`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
cd ~/Dev/kuruma-1067-review-display
git add packages/web/src/vite/reviews/StarDisplay.tsx packages/web/src/vite/reviews/ReviewList.tsx packages/web/src/vite/reviews/ReviewList.test.tsx
git commit -m "feat(#1067): StarDisplay + flag-gated ReviewList component"
```

---

## Task 7: Wire into `StorefrontDetailView` + i18n + barrel

**Files:**
- Modify: `packages/web/src/vite/reviews/index.ts`
- Modify: `packages/web/src/vite/storefronts/StorefrontDetailView.tsx`
- Modify: `packages/web/messages/en.json`, `messages/ja.json`, `messages/zh.json`
- Test: the existing `StorefrontDetailView` test under `packages/web/tests/vite/storefronts/`

- [ ] **Step 1: Add i18n copy**

In `packages/web/messages/en.json`, under `reviews`, add a `list` block:

```json
"list": {
  "heading": "Reviews",
  "empty": "No reviews yet",
  "reviewer": "Verified renter",
  "overallAria": "{n} out of 5 stars",
  "dimensionValue": "{n}/5"
}
```

`messages/ja.json` (`reviews.list`):
```json
"list": {
  "heading": "レビュー",
  "empty": "まだレビューはありません",
  "reviewer": "認証済みの利用者",
  "overallAria": "5つ星中{n}つ星",
  "dimensionValue": "{n}/5"
}
```

`messages/zh.json` (`reviews.list`):
```json
"list": {
  "heading": "评价",
  "empty": "暂无评价",
  "reviewer": "已验证的租客",
  "overallAria": "5 星中的 {n} 星",
  "dimensionValue": "{n}/5"
}
```

- [ ] **Step 2: Barrel export**

In `packages/web/src/vite/reviews/index.ts`, add to the exports:
```ts
export { ReviewList } from './ReviewList'
```
and add to the `./api` export block: `operatorReviewsQueryOptions,` and `type PublicReviewDto,`.

- [ ] **Step 3: Write the failing storefront-section test**

In the existing `StorefrontDetailView` test file, add a case asserting the reviews section renders when the flag is on (reuse that file's render harness + flag mock; the operator-reviews query returns `[]` in the default mock, so assert the heading + empty copy appear):

```tsx
it('renders the reviews section (empty state) when the REVIEWS flag is on', () => {
  vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
  renderDetail() // the file's existing harness with its default detail fixture
  // ReviewList receives `operatorReviews ?? []`; the in-flight query yields
  // `undefined ?? [] = []`, so the empty state renders SYNCHRONOUSLY — no fetch
  // mock and no findByText needed.
  expect(screen.getByText('Reviews')).toBeInTheDocument()
  expect(screen.getByText('No reviews yet')).toBeInTheDocument()
})
```

> **Verified — the earlier "it already mocks `reviewAggregatesQueryOptions`" note was wrong.** The file renders the REAL `useQuery` with no fetch handler and asserts the in-flight skeleton (`StorefrontDetailView.test.tsx:80-99,158-172`). So do NOT add a query mock; add this case to the existing `renderDetail` harness, toggle the flag with `vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')`, and add `afterEach(() => vi.unstubAllEnvs())` if the file doesn't already reset env. Exactly one "No reviews yet" is present — the header rating badge renders a skeleton (no copy) while its aggregate is in-flight.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ~/Dev/kuruma-1067-review-display/packages/web && ../../node_modules/.bin/vitest run tests/vite/storefronts -t "reviews section"`
Expected: FAIL — no "Reviews" heading (section not wired yet).

- [ ] **Step 5: Wire the section into `StorefrontDetailView`**

In `packages/web/src/vite/storefronts/StorefrontDetailView.tsx`:
1. Extend the barrel import (line 1):
```ts
import { RatingBadge, ReviewList, operatorReviewsQueryOptions, reviewAggregatesQueryOptions } from '@/vite/reviews'
```
2. Add a query after the `classRatings` query (~line 49):
```ts
  const { data: operatorReviews } = useQuery(operatorReviewsQueryOptions(storefront.operatorId))
```
3. Render the list after the vehicles block, before the closing `</div>` (~line 102):
```tsx
      <ReviewList reviews={operatorReviews ?? []} />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `../../node_modules/.bin/vitest run tests/vite/storefronts -t "reviews section"`
Expected: PASS.

- [ ] **Step 7: Full gates**

Run:
```bash
cd ~/Dev/kuruma-1067-review-display
bunx tsc -p packages/web --noEmit
cd packages/web && ../../node_modules/.bin/vitest run
cd ~/Dev/kuruma-1067-review-display && bun run scripts/lint-i18n-parity.ts
bun run lint:modules && bun run lint:size
node_modules/.bin/biome check --write packages/web/src/vite/reviews packages/web/src/vite/storefronts/StorefrontDetailView.tsx packages/api/src
```
Expected: tsc clean, web suite green, i18n parity passes (en/ja/zh have identical key sets), lint:modules/size exit 0, biome no diffs.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(#1067): surface operator reviews on the storefront detail page"
```

---

## Definition of Done

- A published, VISIBLE operator review renders (stars + comment + dimensions + month) on the storefront detail page when `VITE_FEATURE_REVIEWS` is on; nothing renders when off.
- Hidden / unrevealed reviews and operator→renter reviews never surface.
- The wire shape carries no `bookingId` / `authorUserId`.
- api: repo (InMemory + real-pg), service, route tests green. web: api-parse, ReviewList, storefront-section tests green.
- tsc (api + web) clean, i18n parity green, `bun run test` green, no migration, boundaries + size + modules lints pass.

## Follow-ups (file as issues, do not build here)

- Vehicle-level review lists on a vehicle detail surface.
- "Load more" pagination (keyset by `publishedAt`) past the newest 20.
- Reviewer first-name/avatar (needs a curated identity projection + privacy review).
- Slice 6 moderation (report endpoint + admin hide) — now unblocked once reviews are visible/reportable.
