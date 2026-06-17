# Vehicle Photo Optimization — Design Proposal

**Date:** 2026-06-16
**Status:** PROPOSAL — awaiting review
**Author:** Claude (session handoff from #879 photo discussion)
**Related:** #879 (PhotoRef source modeling — *out of scope here*), #678 (R2 storage arch, closed), #869 (R2 enabled)

---

## 1. Problem

`vehicles.photos` images are uploaded and stored **byte-for-byte with no resize or
re-encode**. The pipeline today:

```
PhotoUpload.tsx → uploadVehiclePhotosAction → POST /vehicles/:id/photos
  → VehiclePhotoService.uploadPhotos (validate: MIME allowlist, magic-byte sniff,
    5MB cap, max 10/vehicle)
  → R2PhotoStorage.put → bucket.put(file.stream())   ← stored exactly as received
  → public URL appended to vehicles.photos (text[])
```

A 4.9 MB phone photo is stored as 4.9 MB and **served at 4.9 MB to every viewer**.
For a foreigner-facing rental browsed on mobile from overseas, the felt cost is
**page weight and load time**, not the storage bill.

### What this is NOT about

- **It is not a storage-cost problem.** See §2 — at this scale R2 storage is inside
  the free tier and egress is $0. We are optimizing **bytes-on-the-wire / UX**, with
  smaller storage as a free side effect.
- **It is not #879.** `PhotoRef` source modeling (R2-key vs external-URL sum type) is
  orthogonal and remains deferred. This proposal does not touch the `text[]` of URLs
  contract, the validators, or the delete path.

## 2. Cost reality (the numbers, so the reviewer can sanity-check)

R2 pricing: storage **$0.015/GB-month**, **egress $0**, Class A (writes) **$4.50/M**,
Class B (reads) **$0.36/M**. Free tier: **10 GB storage + 1M writes + 10M reads / month**.

Photos scale with **vehicles, not users**: 50 vehicles × 10 photos × 5 MB worst-case
= **2.5 GB → under the free tier → $0/month**, at beta *and* prod. Serving every photo
to all 2000 users is free egress + **$0 of reads while under the 10M/month Class B free
tier** (only $0.36/M marginal beyond it). The classic image-bill killer (egress)
structurally cannot happen on R2.

**Conclusion:** the dollar figure is a non-issue. We optimize because a 5 MB hero image
per car is bad UX on mobile, and resizing is cheap to do. If optimization were free of
risk and effort we'd do it; since it costs some effort, we pick the *minimal* version.

## 3. Constraints

- **API runtime is Cloudflare Workers.** `sharp` and other native-binding image libs
  **do not run on Workers**. Any server-side transform must be Workers-native:
  the `env.IMAGES` binding, Cloudflare Image transformations, or a WASM codec.
- **The only uploader today is the operator via the web form** (`POST /vehicles/:id/photos`
  is `STAFF_ROLES`-gated and rate-limited). No 3rd-party/Trip.com upload path exists.
  This is the single most important scoping fact — it means a **client-side** transform
  covers 100% of real uploads for beta.
- KISS / YAGNI per repo conventions: prefer no new billable CF product and no new
  server dependency unless a non-browser uploader actually appears.

### Precondition — R2 must be wired on the implementation branch

On this checked-out branch (`docs/394-region-search-plan`) **R2 is disabled**:
`packages/api/wrangler.toml` has the `[[r2_buckets]]` binding commented out (blocked
historically on #304 account migration), so the composition root falls back to
`DisabledPhotoStorage`, which returns a 500 on any upload. #869 enabled R2 but that
wiring is **not in this HEAD**. Therefore: **branch the implementation off a base that
includes the #869 R2 binding** (or the beta-deploy R2 enablement per
`project_beta-deploy-existing-account`). Without it, uploads — resized or not — cannot
be exercised end-to-end. The client-side resize itself is testable in isolation
regardless, but the manual "test photo upload" step requires R2 live.

## 4. Options surveyed

| # | Approach | Where | New infra | $ | Saves upload BW? | Server-authoritative? |
|---|----------|-------|-----------|---|------------------|----------------------|
| A | **Client-side resize + WebP** before upload (canvas) | Browser | none | $0 | **Yes** | No (server cap is the backstop) |
| B | Server-side normalize via `env.IMAGES` binding | Worker | CF Images enabled | per-transform | No | Yes |
| C | Server-side normalize via WASM codec (jSquash) | Worker | wasm dep + CPU | $0\* | No | Yes |
| D | Store original, transform **on delivery** (`/cdn-cgi/image/…`) | CDN edge | CF Images enabled | per-transform | No | n/a |

\* WASM is free in dollars but spends Worker CPU time; decoding/encoding a 5 MB image
can approach CPU limits on bundled Workers plans — needs measurement.

### Trade-off notes

- **A (client-side)** is the only option that shrinks the file *before* it crosses the
  network, so it also cuts upload time/bandwidth for the operator. Zero new infra, zero
  cost, fits beta. Weaknesses: transform quality varies slightly by browser; a hostile
  client could still POST a big file — mitigated by keeping the existing 5 MB server cap
  as a hard ceiling (already enforced in `VehiclePhotoService`).
- **B / C (server normalize)** give one authoritative pipeline regardless of caller —
  the right answer *once a non-browser uploader exists*. B is least code but adds a
  billable product; C is free-in-dollars but spends CPU and adds a WASM dep.
- **D (delivery transforms)** is the most flexible (per-surface thumbnail vs hero from
  one stored original) but stores the big original (fine — storage is free) and bills per
  transformation. Best layered on *later* if we want responsive `srcset` variants.

## 5. Recommendation

**Slice 1 (now): Option A — client-side resize + WebP re-encode in `PhotoUpload.tsx`.**

Rationale: it covers 100% of real uploads (operator browser), needs no new CF product
or server dep, costs nothing, and is the only option that also saves upload bandwidth.
The existing server-side validation (MIME sniff + 5 MB cap + count cap) stays exactly as
is and becomes the security backstop — we are adding a client optimization, not removing
a server guarantee.

**Documented evolution (build only when triggered):**

- **Trigger: a non-browser uploader appears** (Trip.com push, bulk import, mobile app)
  → add **Option B or C** server-side normalize so the guarantee is caller-independent.
- **Trigger: we want responsive images / true thumbnails per surface** → add **Option D**
  delivery transforms and emit `srcset`.

This is the KISS path: smallest change that fixes the felt problem, with the bigger
hammers written down and gated on real need rather than built speculatively.

## 6. Detailed design — Slice 1 (client-side)

New pure module `packages/web/src/lib/resizeImage.ts`:

```ts
// Pure-ish transform: File -> downscaled WebP File. No React, no network.
export interface ResizeOptions { maxEdge: number; quality: number; type: 'image/webp' }
export const DEFAULT_RESIZE: ResizeOptions = { maxEdge: 1600, quality: 0.8, type: 'image/webp' }

export async function resizeImage(file: File, opts = DEFAULT_RESIZE): Promise<File>
```

Behavior:
1. `createImageBitmap(file, { imageOrientation: 'from-image' })` — decodes **and bakes
   in EXIF rotation** (critical: phone photos carry orientation flags; canvas otherwise
   draws them sideways).
2. Compute target dims: scale so the longest edge ≤ `maxEdge`; **never upscale** (if the
   image is already smaller, keep original dims).
3. Draw to an `OffscreenCanvas` (fallback to `document.createElement('canvas')`), export
   via `convertToBlob`/`toBlob` to `image/webp` at `quality`.
4. **Verify the encoder actually produced WebP.** `toBlob`/`convertToBlob` is permitted
   to ignore an unsupported `type` and fall back to `image/png` (per MDN). If we blindly
   wrap the blob as `image/webp`, the server's **magic-byte check** (`detectImageType`
   in `vehicle-photo.ts`) sees PNG bytes with a WebP Content-Type and returns **415**.
   So: only wrap as `image/webp` (and `.webp` name) **when `blob.type === 'image/webp'`**.
   Otherwise **fall back to uploading the original file** (which already passed validation).
   Never label a blob with a type its bytes don't match.
5. **Guardrail:** if the re-encoded blob is somehow *larger* than the original (rare —
   e.g. already-optimized small WebP), keep the original. Never make a file bigger.

Wiring in `PhotoUpload.tsx`: keep the **current pre-decode guards on the *original*
file** — MIME allowlist, the **5 MB source-size cap** (so we never decode a 50 MB file
into memory just to shrink it), and the count cap — running exactly as they do today on
the selected files. *Then* map each accepted file through `resizeImage` *before* building
`FormData`. Do **not** move the size check onto the resized output (that would silently
remove the source guard); the resized file is simply whatever we upload. Show the existing
`uploading` state during the (now also-encoding) step.

> Note: the original-file 5 MB cap is retained as the source guard; we are *not*
> introducing a separate cap on the resized output (it is always ≤ the original by the
> §6 step-5 guardrail).

### Edge cases to handle explicitly

- **AVIF input:** browsers can *decode* AVIF in `createImageBitmap` but `toBlob` may not
  *encode* AVIF; we encode to **WebP** regardless of input, which sidesteps this.
- **Animated images (animated WebP/PNG):** canvas flattens to the first frame. Acceptable
  for vehicle photos (no animation expected); note it, don't engineer for it.
- **Decode failure** (corrupt file): `resizeImage` throws → fall back to uploading the
  original file (server still validates). Surface no new error to the operator.
- **Server stays the source of truth.** No change to `vehicle-photo.ts` / `r2-photo-storage.ts`.

## 7. TDD vertical slices

Slice 1 is itself small; tests are unit-level on the pure module plus a component test.

1. **`resizeImage` downscales a wide image** — feed a synthetic 3000×2000 bitmap, assert
   output longest edge == 1600 and aspect ratio preserved (mutation-resistant: exact dims).
2. **Does not upscale** — feed 800×600, assert output stays 800×600.
3. **Output is WebP** — assert returned `File.type === 'image/webp'` and name ends `.webp`.
4. **Never returns a larger file** — feed a tiny already-small image, assert
   `result.size <= original.size`.
5. **EXIF orientation baked** — assert `createImageBitmap` called with
   `imageOrientation: 'from-image'` (the one implementation detail worth pinning, since
   getting it wrong silently rotates every phone photo).
6. **Decode failure falls back to original** — mock `createImageBitmap` to throw, assert
   `validateAndUpload` still POSTs the original file.
7. **Non-WebP encode falls back to original** — stub the encoder to return an
   `image/png` blob (the browser-fallback case), assert the upload is the *original*
   file, **not** a PNG-bytes blob mislabeled `image/webp` (which the server's magic-byte
   check would 415). This pins the §6-step-4 guard.
8. **Oversized source rejected pre-decode** — feed a >5 MB original, assert the existing
   size error fires and `resizeImage` is never called (the source guard still bites).
9. **Component**: selecting a large file results in a `FormData` whose `file` entry is the
   resized WebP (spy on the action).

Test location (current repo convention, verified): the pure module → `packages/web/tests/lib/`,
the component test → `packages/web/tests/components/`. The vitest environment is
**`happy-dom`** (`packages/web/vitest.config.ts`), which — like jsdom — lacks
`createImageBitmap` / canvas encoding, so inject the codec seam (pass an encoder fn into
`resizeImage`, or stub the globals) to keep tests deterministic.

## 8. Existing photos / migration

None. Existing rows keep working — they're URLs to already-stored objects. This change
only affects **new** uploads. No backfill, no migration, no schema change.

## 9. Open questions for the reviewer

1. **`maxEdge` and `quality`** — 1600px / 0.8 WebP is a sane default (~150–300 KB typical,
   crisp on retina hero). Want different targets (e.g. 2048 for a future full-screen
   gallery)?
2. **Scope check** — agree Slice 1 (client-side only) is the right beta scope, with
   server-side normalize (B/C) deferred until a non-browser uploader exists? Or do you
   want the server-authoritative guarantee from day one (heavier, but caller-independent)?
3. **Responsive variants (Option D)** — out of scope now. Confirm we don't need
   per-surface thumbnails yet (storefront card vs detail hero currently both load the
   same URL).
4. Should this get its own GitHub issue (it's adjacent to but distinct from #879), or
   ride under #879's umbrella?
