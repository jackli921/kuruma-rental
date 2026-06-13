# #613 renter liability-disclaimer consent — handoff (2026-06-13)

**Issue:** #613 — replaces dropped online IDP/doc upload (#515/#516/#465 closed not-planned)
with a 免责声明 consent checkbox at checkout, recorded on the booking.
**Worktree:** `~/Dev/kuruma-disclaimer-consent` branch `feat/disclaimer-consent`
**Trunk:** `marketplace-pivot`. Branch tip `e16218c`, ahead 1 / behind ~4. No PR yet.

## DONE — backend slice (committed `e16218c`, ALL gates green)
- shared `db/schema.ts`: `bookings.disclaimerAcknowledgedAt` (timestamptz null) +
  `disclaimerTermsVersion` (text null). **Migration `0052`** (`db:verify` 3/3; DB-sync
  leg skipped locally — CI db-drift covers it).
- shared `validators/booking.ts`: `disclaimerAccepted: z.boolean().optional()` on
  `createBookingSchema`.
- api `routes/bookings.ts` POST /bookings: **gate** — `ctx.role === 'RENTER' &&
  !disclaimerAccepted` → 400 `CONSENT_REQUIRED`. Forwards `disclaimerAccepted ?? false`.
- api `services/booking.ts`: `DISCLAIMER_TERMS_VERSION = '2026-06-13'` const;
  `disclaimerAccepted?: boolean` on `CreateBookingInput`; **stamps** in `submitInTx`
  insert: `disclaimerAcknowledgedAt: accepted ? now : null`, version likewise.
- api repos: `stores.ts` Booking type, `drizzle/shared.ts` (bookingColumns + toBooking),
  `drizzle/booking.ts` insert. In-memory repo spreads `...data` — no change.
- Tests: api 1229 pass, shared 437 pass. New tests in `tests/routes/bookings.test.ts`
  (gate 400 / stamping / staff-exempt). Updated booking fixtures (`tests/helpers/
  booking.ts`, storefront-search/detail, availability, payment) + `manual-booking`,
  `actor-derivation`, `select-columns` (BOOKING_FIELDS + renter seed bodies got
  `disclaimerAccepted: true`).

### Key design decisions (don't relitigate)
- **Enforce at ROUTE (role=RENTER), stamp in SERVICE.** Route is the only place renter-vs-
  staff/source is decided; this keeps blast radius off every service/integration caller.
- **Server-derived** timestamp + version (never trust client). **Nullable** columns
  (staff/manual/historical have no renter consent). Staff/admin/operator exempt.
- Terms version = server constant (no terms table — YAGNI).

## TODO — Phase 3: WEB (not started). All paths in this worktree.
1. `packages/web/src/vite/bookings/api.ts`
   - `CreateBookingInput` (line ~39): add `disclaimerAccepted?: boolean`.
   - `createBooking` body (line ~66): add `disclaimerAccepted: input.disclaimerAccepted`
     (or `?? false`). API ignores it for non-renters; renters need it true.
2. `packages/web/src/vite/reservation/PaymentStep.tsx` (the final wizard step, #511)
   - Add `const [accepted, setAccepted] = useState(false)`.
   - Add a checkbox (NO ui/checkbox primitive exists — use native `<input type="checkbox">`
     + `<label>` for a11y) with localized label + the non-refundable terms text.
   - Gate submit button: `disabled={mutation.isPending || !csrfToken || !accepted}`.
   - mutationFn: `createBooking({ ...bookingInput, disclaimerAccepted: accepted }, csrfToken)`.
3. i18n `packages/web/messages/{en,ja,zh}.json` under `reservation` (new `disclaimer`
   sub-key): `label` (consent statement) + `terms` (IDP/license valid at pickup or the
   order is non-refundable; verification at pickup). MUST add to ALL THREE or i18n-parity
   CI fails. Du's wording is the source; copy is owner-refinable.
4. Test `packages/web/tests/vite/reservation/PaymentStep.test.tsx` (exists): add cases —
   submit disabled until checkbox ticked; ticking enables + POST carries
   `disclaimerAccepted: true`. (Sibling step tests show the RQ/mock pattern.)

### Web gotchas
- `useTranslations('reservation')` is already in PaymentStep — key off `t('disclaimer.*')`.
- Adding a new i18n namespace key needs all 3 locales (en/ja/zh) + counts must match
  (i18n-parity is a separate test-and-build step, not `bun run lint`).
- BookingDto (api.ts) does NOT need the new fields (confirmation page doesn't read them).

## Gates to run (web phase)
`bun run --filter @kuruma/web typecheck` · `bun run --filter @kuruma/web test` ·
`bun run lint:i18n-parity` · biome. Backend already green; re-run api/shared if you
touch them.

## Merge (after web green)
PR base `marketplace-pivot`, `Closes #613`. `gh pr update-branch` if require-up-to-date
trips (swarm moves fast) → watch CI → squash. Manual close #613 + drop in-progress label
(base ≠ default). Teardown worktree. `/code-review` is user-triggered.
