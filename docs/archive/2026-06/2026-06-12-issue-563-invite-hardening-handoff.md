# Handoff — #563 provider-invite hardening (PR #550 follow-up)

**Status:** Claimed + scoped + fully designed. **No code written yet.** Pick up at the TDD RED step below.

## Setup (already done)
- Issue **#563** labeled `in-progress`.
- Worktree `~/Dev/kuruma-563-invite-hardening`, branch `fix/563-invite-hardening`, off `origin/marketplace-pivot @ 84a03b3` (includes #571 FleetFilters). `bun install` done. Tree clean.
- Pure unit-test work: **no DB / no migration / no docker.**

## The two fixes (both LOW, from /code-review of #550)

### Fix 1 — rate-limit IP fails closed
`packages/api/src/routes/provider-invites.ts:27` keys the limiter on `c.req.header('cf-connecting-ip') ?? ''`. If the IP is ever absent, every anonymous caller shares one `''` bucket (over-throttle, or no protection) on a brute-forceable token endpoint.

**Create `packages/api/src/routes/rate-limit.ts`** (does NOT exist yet — safe to create):
```ts
import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import type { Context, MiddlewareHandler } from 'hono'
import { fail } from './helpers'

/** Client IP from CF's header, then proxy fallbacks. null when none present. */
export function clientIp(c: Context): string | null {
  const cf = c.req.header('cf-connecting-ip')
  if (cf) return cf
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() || null
  return c.req.header('x-real-ip') ?? null
}

/** Per-IP limit that FAILS CLOSED: indeterminate IP -> 429, never the shared ''
 *  bucket (#563). Only bites when the limiter binding is wired (CF) AND no IP is
 *  resolvable — a misconfig; on real CF, cf-connecting-ip is always present. */
export function rateLimitByIp(limiter: RateLimitBinding): MiddlewareHandler {
  const limited = rateLimit(limiter, (c) => clientIp(c) ?? '')
  return async (c, next) => {
    if (clientIp(c) === null) return fail(c, 'Too many requests', 429)
    return limited(c, next)
  }
}
```
Then in `provider-invites.ts` replace the inline `ipKey` + `rateLimit(...)` with:
```ts
import { rateLimitByIp } from './rate-limit'
// ...
if (publicCatalogLimiter) app.use('/provider-invites/*', rateLimitByIp(publicCatalogLimiter))
```
**Scope:** the identical `?? ''` pattern is also in `index.ts:566`, `routes/search.ts:29`, `routes/storefronts.ts:32`, `routes/vehicle-classes.ts:36`. **Leave them** (out of #563 scope); mention in the PR as a trivial follow-up that can adopt `rateLimitByIp`.

### Fix 2 — bad operatorId -> 404 (not 500)
`packages/api/src/services/provider-invite.ts` `createInvite` inserts directly; a non-existent `operatorId` hits the FK -> 500. It already holds `this.operatorRepo`.

- Add to `provider-invite.ts`:
```ts
export class OperatorNotFoundError extends Error {
  constructor(readonly operatorId: string) {
    super(`Operator not found: ${operatorId}`)
    this.name = 'OperatorNotFoundError'
  }
}
```
- In `createInvite`, before `this.repo.create(...)`:
```ts
const operator = await this.operatorRepo.findById(input.operatorId)
if (!operator) throw new OperatorNotFoundError(input.operatorId)
```
- In `packages/api/src/routes/admin.ts` (the `.post('/admin/provider-invites', ...)` handler, ~line 35), wrap the call:
```ts
try {
  const created = await providerInviteService.createInvite(parsed.data, requireUser(c).id)
  return ok(c, created, 201)
} catch (e) {
  if (e instanceof OperatorNotFoundError) return fail(c, 'Operator not found', 404)
  throw e
}
```
(Localized catch chosen over a global-handler mapping — YAGNI for one call site. `fail` already imported in admin.ts.)

## TDD plan (RED -> GREEN, one at a time)

**GOTCHA:** `packages/api/tests/routes/rate-limit.test.ts` ALREADY EXISTS (pre-existing app-level wiring tests — do NOT overwrite). Put the `clientIp`/`rateLimitByIp` unit tests in a **new file** `packages/api/tests/routes/rate-limit-helper.test.ts` (or append to the existing one). The ready-to-use test body I drafted is below — use it verbatim:

- `clientIp`: prefers cf-connecting-ip; first x-forwarded-for hop trimmed; x-real-ip fallback; null when none.
- `rateLimitByIp`: no IP -> `c.json({success:false,error:'Too many requests'},429)`, `next` NOT called, `binding.limit` NOT called (the key assertion — proves no `''` bucketing); IP present -> `binding.limit` called with `{ key: '<ip>' }` and `next` called once.
- Context double: `{ req: { header: name => headers[name.toLowerCase()] }, header: vi.fn(), json: vi.fn((b,s)=>({body:b,status:s})) }`. Fake binding: `{ limit: vi.fn(async () => ({ success: true })) }`.

For Fix 2 tests:
- `tests/services/provider-invite.test.ts` (existing — mirror its `beforeEach`; operatorRepo seeded with `op_1`): add `it('throws OperatorNotFoundError for an operatorId that does not exist', ...)` calling `createInvite({ ...INPUT, operatorId: 'op_missing' }, INVITED_BY)` -> `await expect(...).rejects.toThrow(OperatorNotFoundError)`. Happy path already covered (operator exists).
- `tests/routes/provider-invites.test.ts` (existing — `makeApp` seeds operator `op_1`, `bearer({role:'PLATFORM_ADMIN'})`): add `test('bad operatorId -> 404', ...)` posting `{ ...validBody, operatorId: 'op_missing' }` -> `expect(res.status).toBe(404)`.

## Remaining steps
1. Write the failing tests (above), confirm RED.
2. Create `rate-limit.ts`, edit `provider-invites.ts`, edit `provider-invite.ts` + `admin.ts`. Confirm GREEN.
3. Gate: `bun run --filter @kuruma/api test`, `bunx tsc -p packages/api/tsconfig.json --noEmit`, `bun run lint` (biome auto-sorts imports — re-read before further edits), `bun run --filter @kuruma/api lint:boundaries`.
4. Commit (`fix(provider-invites): fail-closed IP rate-limit + 404 on unknown operatorId (#563)`), end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.
5. Rebase onto `origin/marketplace-pivot`, push `-u`, `gh pr create --base marketplace-pivot` with `Closes #563`.
6. Base ≠ default branch -> after merge, **close #563 manually** + drop `in-progress` + remove worktree/branch. Remote branch will linger (ruleset blocks deletion).

## Notes
- Architecture: routes -> services -> repos. `rate-limit.ts` lives in `routes/` and imports `routes/helpers` (`fail`) — same layer, allowed.
- `OperatorRepository.findById` returns operator-or-null (see `preview` at provider-invite.ts:90 for the existing usage pattern).
