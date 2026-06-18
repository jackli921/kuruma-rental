# Design — #932 Platform-Admin Renter-Document Review UI

- **Issue:** #932 (follow-up to #459 document-verification gate)
- **Branch:** `feat/932-document-approval-ui` (off `develop`)
- **Author session date:** 2026-06-17
- **Status:** For review — no code written yet.

---

## 1. Problem

The #459 document-verification gate is built and flag-gated (`REQUIRE_DOCUMENT_VERIFICATION`,
default OFF). When ON, a renter without an **approved** identity document is 403'd at booking.

The backend for reviewing those uploads exists, but **no UI calls it** — staff can only
approve/reject via raw API. A real document-gated launch needs an in-app review surface.

### What already exists (verified)

| Layer | Symbol | Path |
|-------|--------|------|
| Renter upload UI | `DocumentUploadCard`, `DocumentStatusBadge` | `packages/web/src/vite/documents/` |
| Renter route | `/$locale/_renter/documents` | `packages/web/src/routes/$locale/_renter/documents.tsx` |
| List (staff) | `GET /documents?limit&offset` → `{ documents, total }` (PENDING, oldest-first) | `packages/api/src/routes/documents.ts:56` |
| Verify (staff) | `POST /documents/:id/verify` | `packages/api/src/routes/documents.ts:67` |
| Service | `RenterDocumentService` (`listPending`, `verify`) | `packages/api/src/services/renter-document.ts:36` |
| Repo authz | `isPlatformStaff(ctx) || row.renterId === ctx.userId` | `packages/api/src/repositories/drizzle/renter-document.ts:35` |
| Entity | `RenterDocument` (`id, renterId, type, storageKey, status, expiryDate, verifiedAt, verifierId, rejectionReason, …`) | `packages/api/src/stores.ts:336` |
| Enums | `DOCUMENT_TYPES` `['IDP','PASSPORT']`, `DOCUMENT_STATUSES` `['PENDING','APPROVED','REJECTED']` | `@kuruma/shared/enums` |
| Verify validator | `verifyDocumentSchema` (APPROVED⇒`expiryDate`, REJECTED⇒`rejectionReason`) | `@kuruma/shared/validators/document` |

### The two gaps

1. **No staff UI** calling `GET /documents` / `POST /documents/:id/verify`.
2. **No way to view the uploaded scan.** `DocumentStorage.getSignedUrl()` throws —
   R2 presigned URLs need S3 SigV4 creds, blocked on the parked #304 CF migration
   (`packages/api/src/repositories/r2-document-storage.ts:35`).

---

## 2. Decisions (locked with owner)

### D1 — Platform-Admin page, **not** operator portal
The issue title says "operator-facing," but `GET /documents` and `POST /documents/:id/verify`
are gated to `STAFF_ROLES` = **`PLATFORM_ROLES` = `{ PLATFORM_ADMIN }`** only
(`packages/api/src/repositories/drizzle/renter-document.ts:35`; "operators cannot review documents").

→ Build in the **admin portal** (third dashboard, `AdminSidebar`) and call the endpoints as-is.
**No authz widening, no security-model change.** The title is imprecise; the backend is the
source of truth. Operator-scoped review would require widening `STAFF_ROLES` on the document
endpoints plus a tenant-scoping security review (can op A see op B's renters' docs?) — explicitly
**out of scope**.

### D2 — R2 streaming proxy for viewing, **not** presigned URLs
Presigned URLs are blocked on #304. But the Worker holds the R2 binding
(`globalThis.RENTER_DOCUMENTS`), so it can read the object server-side and stream the bytes to an
authenticated staff caller — **no #304 dependency.**

→ Add a staff-only `GET /documents/:id/file` that streams the R2 object.

### D3 — No feature flag
Admin pages are **always-on** (no `VITE_FEATURE_ADMIN`; revenue/anomalies render
unconditionally — `packages/web/src/vite/config/features.ts`). Only `PLATFORM_ADMIN` reaches the
admin portal via `adminGuard` (`packages/web/src/vite/guards.ts:41`), so a flag is redundant.
Matches existing admin convention. (If the owner later wants it hidden even from admins until the
#488 demo flip, a flag is a trivial add — YAGNI for now.)

---

## 3. Slice 1 — Backend: R2 streaming proxy

`GET /documents/:id/file` (auth + `STAFF_ROLES`) → streams the scan inline.

### Changes
- **`R2BucketLike`** (`packages/api/src/repositories/r2-photo-storage.ts:5`): add
  `get(key): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>`
  (mirror the real CF `R2Bucket.get` shape we depend on).
- **`DocumentStorage`** (`packages/api/src/repositories/types.ts:792`): add
  `getFile(key): Promise<{ body: ReadableStream; contentType: string } | null>`.
- **`R2DocumentStorage`** (`r2-document-storage.ts`): implement `getFile` via `bucket.get(key)`;
  `contentType` from `obj.httpMetadata?.contentType ?? 'application/octet-stream'`; `null` if absent.
- **`DisabledDocumentStorage`** (`disabled-document-storage.ts:11`): `getFile` **throws** the same
  `MESSAGE` as its sibling methods — the class rejects loudly on every op by design
  (`put`/`getSignedUrl`/`delete` all throw). This path is **unreachable in practice**: when the R2
  binding is absent, `put` also throws, so no documents exist to view. (We do **not** make `getFile`
  return `null` here — that would silently deviate from the class's loud-rejection contract.)
- **`InMemoryDocumentStorage`** (`repositories/in-memory/document-storage.ts:12` — the test double
  used by service tests): **also implements `DocumentStorage`**, so it must gain `getFile` or the
  interface change fails typecheck. It currently stores `Map<string, ArrayBuffer>` and **discards
  `file.type`** — widen the value to `{ bytes, contentType }` (capture `file.type` in `put`) and
  return `{ body: new Blob([bytes], { type: contentType }).stream(), contentType }` from `getFile`.
  (`Blob.stream()` is a non-null `ReadableStream`; `new Response(bytes).body` is typed nullable and
  would fail the `getFile` return type.) This also lets Slice 1's service tests assert the streamed
  `Content-Type`.
- **`RenterDocumentService.getFile(ctx, id)`** (`services/renter-document.ts`): authorize by
  reusing `repo.findById(ctx, id)` (already enforces staff-cross-renter / renter-own), then
  `storage.getFile(row.storageKey)`. Return `{ body, contentType, type }` or `undefined`.
- **Route** (`routes/documents.ts`): on hit, `return c.body(file.body, 200, { 'Content-Type':
  contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'no-store', 'X-Content-Type-Options':
  'nosniff' })` — the last two harden a private scan response (no caching of identity docs, no MIME
  sniffing). `404` via `fail()` helper when service returns `undefined`. (No existing file-stream
  route — this establishes the pattern; `auth.ts` shows `c.body(null, 204)` as the non-JSON precedent.)

### Tests (TDD, one behavior per cycle)
1. Service `getFile`: platform staff reads any renter's file ✓.
2. Service `getFile`: renter reading **another** renter's id → `undefined` ✗.
3. Service `getFile`: missing id / missing R2 object → `undefined` (→ 404).
4. Route: streams the object body with the stored `Content-Type`.
5. Route: non-staff caller → 403 (matches list/verify gate).

---

## 4. Slice 2 — Web: Admin document-review page

Route `/$locale/_admin/admin/documents`, mirroring the revenue page
(`packages/web/src/routes/$locale/_admin/admin/revenue.tsx`).

### Feature API module — `packages/web/src/vite/admin/documents/api.ts`
- Local `adminDocumentSchema` (Zod) — the Vite shell **owns its own DTO**. It must **not** import the
  api `RenterDocument` interface (`packages/api/src/stores.ts:336` — there is no `@kuruma/shared`
  copy); the `lint:modules` / api↔web boundary forbids reaching into the api package. Enum fields
  anchor to `@kuruma/shared/enums` (`DOCUMENT_TYPES`/`DOCUMENT_STATUSES` — the real SSoT) and the DTO
  type is `z.infer`'d from the schema, exactly mirroring the renter `vite/documents/api.ts:9-34`
  (which has **no** `satisfies`-against-api). Non-strict, so server-only `storageKey`/`verifierId`
  are validated-away and never reach the client.
- `pendingDocumentsQueryOptions()` → `GET /documents` (`credentials: 'include'`, `unwrap(res, schema)`),
  key `['admin-documents','pending']`.
- `verifyDocument({ id, status, expiryDate?, rejectionReason?, csrfToken })` → `POST
  /documents/:id/verify`. **Destructure `csrfToken` out and `JSON.stringify` only the verdict fields**
  (`{ status, expiryDate?, rejectionReason? }`) — the token rides the `'X-CSRF-Token'` header, never
  the JSON body. (`credentials: 'include'`; threaded from the session exactly like `uploadDocument` at
  `vite/documents/api.ts:61-78`; the page reads `csrfToken` off the session query, the same source the
  team/settings mutations use.) A test asserts the body excludes `csrfToken`. Validated
  client-side against `@kuruma/shared/validators/document`'s `verifyDocumentSchema` cross-field rule
  before sending.
- `documentFileUrl(id)` → `` `${getApiBaseUrl()}/documents/${encodeURIComponent(id)}/file` `` — must
  carry the `/api` base (`vite/api-base.ts:11`), else the `<img>` hits the SPA origin, not Hono.

### Route file — `routes/$locale/_admin/admin/documents.tsx`
- `loader`: `context.queryClient.ensureQueryData(pendingDocumentsQueryOptions())` (mirrors revenue).
- Component: `useSuspenseQuery`, render a list of pending docs (renter id, `type`, uploaded date,
  `DocumentStatusBadge`). Each row → a `DocumentReviewCard`:
  - **Viewer:** `<img src={documentFileUrl(id)}>` (cookie-authed, same-origin) with a download
    fallback link; non-image content-types fall back to the link.
  - **Approve:** date input → `expiryDate` (required); **Reject:** text input → `rejectionReason`
    (required, non-empty). Submit → `useMutation(verifyDocument)` → on success invalidate
    `['admin-documents','pending']` (verified docs leave the PENDING list).
- Reuse `DocumentStatusBadge` from `vite/documents/`.

### Nav + i18n
- Add `{ to: '/$locale/admin/documents', icon: <FileCheck>, labelKey: 'nav.documents' }` to
  `SIDEBAR_ITEMS` in `packages/web/src/vite/nav/AdminSidebar.tsx:5`.
- New i18n: `admin.documents.*` (title, subtitle, empty, approve, reject, expiryLabel,
  reasonLabel, viewer fallback, success/error toasts) + `nav.documents` — in
  `packages/web/messages/{en,ja,zh}.json`. **Verify all three locales after merge** (per CLAUDE.md
  i18n gotcha — conflict resolution silently drops keys).

### Tests
- API module: `verifyDocument` posts the correct body for APPROVE (with `expiryDate`) and REJECT
  (with `rejectionReason`); CSRF header present.
- Page: renders the pending list; clicking Approve fires the mutation with `{status:'APPROVED',
  expiryDate}`; Reject with `{status:'REJECTED', rejectionReason}`; empty-state when no pending.
- a11y: `<label htmlFor>` on expiry + reason inputs; `aria-label` on icon-only actions.

---

## 5. Out of scope

- Operator-scoped document review (would need `STAFF_ROLES` widening + tenant-scoping review).
- Presigned URLs / #304 work (the streaming proxy sidesteps it).
- Wiring the renter-side Documents nav entry / un-hiding it in beta (#942 left it hidden — separate).
- Feature-flagging the admin page (D3).
- Pagination UI beyond the existing `limit/offset` (list is small; add later if needed).

## 6. Risks / notes

- **Streaming a private scan:** the `/file` route must keep the `STAFF_ROLES` gate; the `img`
  request is cookie-authed same-origin, so no token leakage in URLs. Confirm CSP `img-src 'self'`
  permits it (it does — same origin).
- **`R2BucketLike.get` shape:** we model only the fields used (`body`, `httpMetadata.contentType`)
  to keep the seam testable with an in-memory fake; do not pull in the full CF `R2Object` type.
- **Viewer fallback (when, exactly):** the graceful 404/fallback comes from two real paths — (a)
  `R2DocumentStorage.getFile` returning `null` for a genuinely missing R2 object → service `undefined`
  → route 404; and (b) a non-image `Content-Type`, where the UI shows a download link instead of an
  `<img>`. It is **not** driven by `DisabledDocumentStorage` (that throws, and is unreachable since
  uploads also throw when R2 is absent — see Slice 1). Local/dev uses `InMemoryDocumentStorage`, which
  returns real bytes.

## 7. Execution

TDD vertical slices, Slice 1 then Slice 2; commit per green slice; rebase on `develop` between
slices; `/verify` after tests pass; `/code-review` + architect-review before PR. PR `Closes #932`.
