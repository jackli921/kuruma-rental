# #1085 slice 5 — reviews: aggregates surfaced

> Date: 2026-06-27 · Issue: [#1085](https://github.com/jackli921/kuruma-rental/issues/1085) · Epic: [#1067](https://github.com/jackli921/kuruma-rental/issues/1067)
> Worktree: `~/Dev/kuruma-1085-aggregates` · Base: `origin/develop@28d35a96`
> Revision 2: addresses code-review findings P1×2 + P2×3 (auth, IDs in DTOs, rate-limit, loading vs no-review, perf claim).

## Scope

Aggregate published+visible review ratings (avg + count) for three subjects — operator, vehicle, class — and surface them on the public-facing surfaces a renter sees BEFORE booking. Slice 6 (moderation) will write the `moderationStatus='HIDDEN'` flag; the filter we add now reads it correctly the day slice 6 lands. Forward-compatible.

## Architectural fit (no surprises)

Slice 1 denormalized `operatorId`, `subjectVehicleId`, `subjectClassId` and named the slice-5 scan index in code:

- `idx_reviews_operator_published(operatorId, publishedAt)` — comment in `review.ts:114` literally says _"the slice-5 published-aggregate scan"_.
- `idx_reviews_subject_vehicle(subjectVehicleId)` and `idx_reviews_subject_class(subjectClassId)` — single-column FK covers (slice-1 lint:fk-indexes default).

The `ReviewRepository` JSDoc also flags this slice: _"subject aggregates (slice 5) layer on top of this contract."_

**No migration in this slice** — see §"Performance posture" for the scale defense and follow-up.

## Subjects + UI matrix

| Aggregate | DB filter | API endpoint | v1 UI consumer |
|---|---|---|---|
| **operator** | `operatorId IN (?) AND publishedAt IS NOT NULL AND moderationStatus='VISIBLE'` | `GET /reviews/aggregates/operators?ids=…` | StorefrontCard (search list), StorefrontDetailView header |
| **vehicle** | `subjectVehicleId IN (?) AND publishedAt IS NOT NULL AND moderationStatus='VISIBLE'` | `GET /reviews/aggregates/vehicles?ids=…` | none in v1 — API/service tested, future slices may consume |
| **class** | `subjectClassId IN (?) AND publishedAt IS NOT NULL AND moderationStatus='VISIBLE'` | `GET /reviews/aggregates/classes?ids=…` | AvailableVehicleCard (per car in storefront detail) |

**Why expose vehicle when no UI consumes it:** the issue body's acceptance criteria says _"aggregates (operator avg+count, vehicle/class avg) recompute correctly"_ — vehicle-level is in the contract. Adding it now keeps the read surface symmetric and saves a follow-up PR.

## P1 fix — public read mount NOT under `requireAuth('/reviews/*')`

`createReviewRoutes` in `routes/reviews.ts:17-19` registers `app.use('/reviews/*', requireAuth())` BEFORE its handlers. Adding `GET /reviews/aggregates/*` inside that router would inherit the wildcard auth.

**Fix:** new file `packages/api/src/routes/review-aggregates.ts` exporting `createReviewAggregateRoutes(service)`. **Public** — no `requireAuth()`. Mounted in `index.ts` AFTER `createReviewRoutes` so the two routers coexist at the same `/reviews` root: Hono dispatches by exact path match, the wildcard middleware on `createReviewRoutes` does not bleed across routers (only across handlers within the same Hono instance). Pinned by a route-integration test asserting `GET /reviews/aggregates/operators?ids=op1` returns 200 with NO cookie / Authorization header.

```ts
// index.ts (composition root)
app.route('/', createReviewRoutes(reviewService))            // auth-walled writes + booking-scoped read
app.route('/', createReviewAggregateRoutes(aggregateService, publicCatalogLimiter))  // public reads
```

## P1 fix — extend public detail DTOs with renter-safe IDs

Audit of what the UI needs vs what the wire ships today (`storefront-detail.ts:16-50`, `web/.../schema.ts:54-88`):

| Surface | Needs id | Has id today? | Action |
|---|---|---|---|
| StorefrontCard (search list) | `operatorId` | **yes** (`schema.ts:33`) | nothing |
| StorefrontDetailView header | `operatorId` | **no** — `StorefrontSummary` is name/address/hours only | add `operatorId: string` to `StorefrontSummary` (producer + shared) + `storefrontSummarySchema` (web) |
| AvailableVehicleCard | `classId` | **no** — only `classLabel` + `acrissCode` | add `classId: string \| null` to `AvailableVehicle` (producer + shared) + `availableVehicleSchema` (web) |

- Producer changes are pure additive whitelist extensions — no new tables, no new tenant exposure (the operator that owns a public storefront IS public; class ids are public catalog identifiers).
- Pinned by `storefront-detail.test.ts` (producer) + `vite/storefronts/schema.test.ts` (web Zod parse-and-pin).
- `classId` is nullable because `vehicles.classId` is nullable (already true elsewhere — `AvailableVehicle.classLabel` falls back to `''` for unclassed cars). A null `classId` means "no class aggregate" — UI renders the badge skipped, not a "no reviews" pill.

## Repo extension — `ReviewRepository`

Three batch methods, single-id is a 1-element batch (avoids N+1 from the caller). Sum + count returned raw (service decides avg presentation).

```ts
aggregateByOperator(operatorIds: readonly string[]): Promise<Map<string, { sum: number; count: number }>>
aggregateByVehicle(vehicleIds:  readonly string[]): Promise<Map<string, { sum: number; count: number }>>
aggregateByClass(classIds:    readonly string[]): Promise<Map<string, { sum: number; count: number }>>
```

- Drizzle impl: one `SELECT subjectId, SUM(overall), COUNT(*) FROM reviews WHERE …id IN (…) AND publishedAt IS NOT NULL AND moderationStatus='VISIBLE' GROUP BY subjectId` per method. Returns a Map — ids with no rows are absent.
- InMemory impl: `Array.filter(…)` over `this.reviews`, reduce.
- Both impls share the same predicate semantics (mutation-resistant tests assert the predicate, not the implementation).
- Empty `ids` array → empty Map, zero queries. Cap enforcement lives in the service (see below) so the repo accepts any size — keeps the data layer thin.

## Service — `ReviewAggregateService`

`packages/api/src/services/review-aggregate.ts`. Owns the avg computation, the cap, and the null vs absent semantics.

```ts
export interface AggregateEntry { readonly avg: number; readonly count: number }
export type AggregateMap = Record<string, AggregateEntry | null>  // null = id known to caller but has no published+visible reviews

export class ReviewAggregateService {
  constructor(private readonly reviewRepo: ReviewRepository) {}
  async forOperators(ids: readonly string[]): Promise<AggregateMap> { /* … */ }
  async forVehicles(ids:  readonly string[]): Promise<AggregateMap> { /* … */ }
  async forClasses(ids:   readonly string[]): Promise<AggregateMap> { /* … */ }
}
```

- `avg` rounded to 1 decimal (display-quality).
- `null` (NOT `{avg:0,count:0}`) for ids with no reviews — UI distinguishes "no rating yet" from "rated 0".
- Cap enforced HERE not at the route: requests with > `MAX_IDS` (100) get a thrown `INVALID_IDS_COUNT` Fail. The route maps it to a 400.
- **No authz** — these are public read-side aggregates. The route mounts without `requireAuth()`.

## Routes — `routes/review-aggregates.ts` (new file)

Public Hono router with `publicCatalogLimiter` applied to the prefix.

```ts
export function createReviewAggregateRoutes(
  service: ReviewAggregateService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()
  if (publicCatalogLimiter) {
    app.use('/reviews/aggregates/*', rateLimitByIp(publicCatalogLimiter))  // P2 fix
  }
  return app
    .get('/reviews/aggregates/operators', /* parse ids → service.forOperators */)
    .get('/reviews/aggregates/vehicles',  /* parse ids → service.forVehicles */)
    .get('/reviews/aggregates/classes',   /* parse ids → service.forClasses */)
}
```

- `?ids=a,b,c` (comma-separated; same shape as `vite/reviews/api.ts` uses for `subjects`).
- Missing `ids` → 400 `IDS_REQUIRED`.
- >100 ids → 400 `TOO_MANY_IDS` (service-thrown).
- Response: `{ aggregates: { [id]: { avg: number; count: number } | null } }`.
- **Public** — must work for an anonymous renter on `/search` who hasn't signed in. Pinned by an integration test that hits the route with no `Cookie` / `Authorization` header.

## P2 fix — rate-limit reuses `publicCatalogLimiter`

Storefront catalog (`storefronts.ts:33-34`) applies `rateLimitByIp(publicCatalogLimiter)` because anonymous reads are the most-scraped surface. Aggregates are cheaper to scrape per byte (just numbers — easier to bulk-pull than storefront cards). They get the **same** limiter; no carve-out. The composition root passes the same `publicCatalogLimiter` binding to both routers.

## P2 fix — `RatingBadge` state semantics, locked by tests

| Input | Render | aria-label |
|---|---|---|
| `undefined` | skeleton placeholder (a fixed-width muted bar) | — |
| `null` | `"No reviews yet"` | `"No reviews yet"` |
| `{avg, count}` | `★ {avg} ({count})` | `"{avg} stars, {count} reviews"` |

Three vite tests pin the three branches by exact assertion (no `toBeTruthy()`). The same component is used everywhere — visual rhythm uniform.

```tsx
<RatingBadge entry={entry} size="sm" />
// entry: AggregateEntry | null | undefined
```

When the operator/class id is itself nullable (e.g. `AvailableVehicle.classId === null`), the parent does NOT render the badge at all — null `entry` reads as "rated zero reviews", null `classId` reads as "not classable". Different meanings, distinguished at the call site.

## Web — fetch + three wirings

**New fetch** `vite/reviews/api.ts` adds `fetchAggregates(type: 'operators'|'vehicles'|'classes', ids: string[]): Promise<AggregateMap>`. Single TanStack Query hook (`useReviewAggregates(type, ids)`) keyed on **sorted+deduped** ids (so `[a,b]` and `[b,a]` share the cache entry). Empty ids → bypass fetch, return `{}`.

**Three wirings:**
1. `vite/storefronts/StorefrontCard.tsx` — operator badge under the operator name (uses existing `storefront.operatorId`).
2. `vite/storefronts/AvailableVehicleCard.tsx` — class badge under the class name (uses NEW `vehicle.classId`; skipped when null).
3. `vite/storefronts/StorefrontDetailView.tsx` — operator badge in header (uses NEW `storefront.operatorId`).

Search list page batches all visible operator ids into one fetch. Storefront detail page batches all non-null class ids of the available vehicles into one fetch. Operator-badge fetch for the detail header is one extra single-id query.

## i18n keys (`packages/web/messages/{en,ja,zh}.json`)

```json
"reviews": {
  "aggregate": {
    "rating": "★ {avg} ({count})",
    "noReviews": "No reviews yet",
    "ratingAria": "{avg} stars, {count} reviews"
  }
}
```

JA: `"レビューはまだありません"` / `"{avg}つ星、{count}件のレビュー"`. ZH: `"暂无评价"` / `"{avg}星，{count}条评价"`.

## Performance posture (P2 fix — soften the claim)

The reviewer is right: vehicle and class scans only have single-column indexes today. The query plan for e.g. `SELECT subjectVehicleId, SUM(overall), COUNT(*) FROM reviews WHERE subjectVehicleId IN (?, …) AND publishedAt IS NOT NULL AND moderationStatus='VISIBLE' GROUP BY subjectVehicleId` will use the single-column index for the IN range, then apply the filter — fast at v1 scale (greenfield, no reviews exist in prod yet; renter base ~200 today, target ~2000) but degrades when one operator's vehicle accrues thousands of reviews.

**Action in this PR:**

- Soften the "no migration" claim from "covers" to "is the lookup path; partial published+visible cover index not yet warranted."
- Include `EXPLAIN ANALYZE` output in the PR description showing index use for both vehicle and class scans on the seeded test DB.

**Deferred follow-up issue (file before merge):** _"Add partial cover indexes for slice-5 vehicle/class aggregates"_ — mirror `idx_reviews_operator_published` for vehicle and class:

```sql
CREATE INDEX idx_reviews_subject_vehicle_published
  ON reviews (subjectVehicleId, publishedAt)
  WHERE moderationStatus = 'VISIBLE' AND publishedAt IS NOT NULL;
CREATE INDEX idx_reviews_subject_class_published  ON reviews (subjectClassId,   publishedAt)
  WHERE moderationStatus = 'VISIBLE' AND publishedAt IS NOT NULL;
```

Doing this in a separate PR keeps slice 5 zero-migration (away from the current swarm collision risk per `feedback_aggregate-test-before-push` lessons) and aligns with the per-feature-review hook at the end of the epic.

## TDD order (RED → GREEN, one cycle at a time)

1. **InMemory repo** — 6 tests × 3 methods: empty, single published+visible, multiple published, HIDDEN excluded, unpublished excluded, batch mixed.
2. **Drizzle repo** — same predicate, condensed to 2 real-pg tests per method (the InMemory tests already cover the predicate matrix).
3. **`ReviewAggregateService`** — 5 tests: forwards to repo, avg rounding, null for unrated, cap throws, batch shape.
4. **Routes (review-aggregates)** — 4 tests per endpoint: 200 happy path, 400 missing ids, 400 too many ids, public (no JWT) reachable (asserts the auth-mount fix). 12 total.
5. **DTO extension** — `storefront-detail.test.ts` pins new `operatorId` + `classId`; `vite/storefronts/schema.test.ts` parses the extended wire.
6. **`RatingBadge`** — 3 vite tests pinning the three input branches.
7. **`useReviewAggregates`** — 2 tests: dedups+sorts ids, empty bypass.
8. **StorefrontCard / AvailableVehicleCard / StorefrontDetailView** — extend existing tests to assert badge presence + that the null-classId vehicle renders no badge.

## Verification gates (before push)

- `bun run test` (aggregate, all packages — per memory `feedback_run-aggregate-test-before-push`)
- `tsc --noEmit` × 3 packages
- `bun run --filter @kuruma/api lint:boundaries`
- `bun run lint:modules` + `lint:size`
- `bunx biome check` (if anything reformatted)
- `bun run db:verify` (sanity — no schema change, but the gate is cheap)
- vite build (regenerates `routeTree.gen.ts` — no new routes, but feature-boundary baseline may drift if the badge crosses a feature line)
- code-reviewer agent on the worktree before push
- Capture EXPLAIN ANALYZE for vehicle + class queries → PR description

## Risk register (revised)

| Risk | Mitigation |
|---|---|
| `/reviews/*` middleware leaks into aggregates (P1) | Separate router file, route-test asserts anonymous 200 |
| Detail UI lacks ids needed to fetch (P1) | Extend DTOs (producer + Zod), pinned by schema tests |
| Vehicle/class scans slow at scale (P2) | Single-col index now + EXPLAIN in PR + follow-up issue for partial cover indexes; current scale (greenfield) makes this a future concern, not a blocker |
| Public endpoint scraped (P2) | `publicCatalogLimiter` reused (matches `/storefronts/*`) |
| `RatingBadge` ambiguous state (P2) | `undefined` = skeleton, `null` = no-reviews, `{avg,count}` = data — pinned by three tests |
| `RatingBadge` accessibility | `aria-label="{avg} stars, {count} reviews"` on visual; "No reviews yet" on null branch |
| Web feature-boundary baseline drift | If badge in `vite/reviews/` and storefront cards reach in, baseline goes up. Bump by hand only if increased; verify the script doesn't also touch `DEPRECATED_WEB_TREE` (per memory `project_1088-operators`). |
| Sibling PRs land mid-flight | Standard merge-chase. Files I touch: api routes/services + storefronts producer + web schema. Overlap with #1188 (operators) unlikely; with #1199 (maint-overbook) none. |

## What this is NOT

- Not slice 6 moderation. The `moderationStatus='VISIBLE'` filter is in place but no admin hide flow yet.
- Not author/per-review surfacing. Aggregates only — individual review text is a follow-up.
- Not a sort-by-rating signal on `/search`. Just display.

## Out-of-scope follow-ups (not blocked by slice 5)

- **Partial cover indexes for vehicle/class** (filed as a follow-up issue before merge — see §Performance posture).
- Sort `/search` by operator rating (renter discovery).
- Rating-aware vehicle ranking inside a storefront.
- Per-review excerpts on the storefront page.
