# #678 — Decision: defer key-only photo persistence; ship the delete-parse hardening

**Date:** 2026-06-15
**Issue:** #678 · **Branch/worktree:** `feat/678-photo-key-migration` · `~/Dev/kuruma-678-photo-key`
**Status:** DECIDED — deferred. One small hardening shipped on this branch.

## What happened
A first pass proposed migrating `vehicles.photos` / `vehicle_classes.photos` from full URLs to object **keys** ("store the key, derive the URL at read"). A code review (and verification against the code) showed that framing was too simple:

- Both validators are `z.string().url()` — a bare key **fails validation**; create/update spread `photos` straight to the DB (`updateVehicleSchema`), and web `VehicleForm.tsx:95` round-trips `vehicle.photos`. So generic write paths reintroduce URLs.
- No single serialization boundary — `/vehicles`, `/vehicles/:id`, fleet-overview, detail, booking-query, storefront/flat-search, and write responses all emit `photos` raw. Keys would leak to the operator UI.
- Delete under mixed key/URL rows silently no-ops.
- **The contract is "a list of image URLs" — and external URLs are valid.** So the column cannot be "pure key" without modeling source (R2 key vs external URL).

## Decision
**Defer the key-only persistence.** For a sole-proprietor beta with ~zero photo data and no bucket/domain move planned, the env-coupling is a speculative cost and the back-fill is just as trivial later as now (YAGNI/KISS). Doing it correctly is a real design — modeling `PhotoRef = { source:'r2', key } | { source:'external', url }` with one serializer across all surfaces — tracked in **#879**.

- `vehicles.photos` / `vehicle_classes.photos` stay URL arrays for beta. No schema/data migration.
- #678's architecture decision (R2; public/private; key-only target) is recorded and R2 is enabled (#869). #678 can close, with #879 carrying the deferred persistence work.

## Shipped on this branch (the one thing worth doing now)
Hardened `R2PhotoStorage.delete()` (review finding F4): replaced loose `startsWith(publicBaseUrl)` + `slice(len+1)` with exact URL parsing via a pure `toObjectKey(keyOrUrl, base)` helper.
- Fixes a trailing-slash base eating a key character, and a look-alike host (`…com.evil/…`) being mis-sliced into a bogus key.
- New `packages/api/tests/repositories/r2-photo-storage.test.ts` (7 tests, TDD: 2 red → green). Full API suite 1519 green, typecheck clean.

## Follow-ups
- **#879** — model photo source (PhotoRef); the real key-only work + the review's F1/F2/F3.
- Private renter-document signed URLs (`R2DocumentStorage.getSignedUrl` still throws) — #459 track, needs an R2 S3 SigV4 token (HITL).
