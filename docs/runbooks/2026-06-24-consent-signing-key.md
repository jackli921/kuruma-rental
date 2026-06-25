# Consent Signing Key — Provisioning & Rotation Runbook

> **P1 / security (#1048).** The consent ledger (#877) signs every renter/operator
> consent acceptance with an HMAC-SHA256 keyed on `CONSENT_SIGNING_KEY`
> (`packages/api/src/services/consent-signing.ts`). If the secret is **absent**,
> `resolveSigningKey()` returns `undefined` and the service writes
> `recordSignature: null` **silently** — no error, no alert. The moment consent
> Phase 2 (#1044 / #1033) ships its renter accept endpoint, prod would start
> recording **unsigned** consent rows. **Set this secret before #1044 merges.**

## What the secret is

| Name | Where | Sensitive | Default |
|------|-------|-----------|---------|
| `CONSENT_SIGNING_KEY` | API Worker secret (`wrangler secret put`) | **yes** | none → unsigned |
| `CONSENT_SIGNING_KEY_ID` | code env (optional) | no | `'v1'` |

The `keyId` is bound into each signature and stored on `consent_records.signingKeyId`,
so a verifier can look up which key signed a given row. Until the keyId registry
(#1048 item 3) lands, the single default `'v1'` is fine — do **not** rotate the key
value yet, or previously-signed rows become unverifiable.

## Provision (do this before #1044 merges)

1. Generate a 256-bit key:
   ```bash
   openssl rand -hex 32
   ```
2. Add it as a GitHub repository secret named **`CONSENT_SIGNING_KEY`**
   (Settings → Secrets and variables → Actions → New repository secret).
3. Push it onto the API Worker by running the **Rotate Worker Secrets** workflow
   (Actions → `rotate-secrets.yml` → Run workflow). It re-asserts every secret —
   including the new `CONSENT_SIGNING_KEY` line — and promotes a fresh deploy.
   - Pre-req: clean Worker state (no pending un-promoted version). If `wrangler
     secret put` errors, run `deploy.yml` first to flush, then re-run.
4. Verify it took: a renter consent acceptance after the deploy writes a non-null
   `recordSignature` on its `consent_records` row.

## Rotation (later — needs the keyId registry, #1048 item 3)

Rotating the key value invalidates verification of every row signed under the old
key **unless** the old `keyId → key` mapping is retained. Do not rotate until the
registry exists: then bump `CONSENT_SIGNING_KEY_ID` (e.g. `v2`), keep the `v1` key
available to the lookup, and only new rows sign under `v2`.

## What this runbook does NOT cover (owned by the consent session — #1048)

This runbook + the `rotate-secrets.yml` wiring are the **infra half**. The code-side
fail-closed protection stays with the consent workstream:

- **Item 2** — composition-root presence check that *throws at boot* in non-test
  envs when `CONSENT_SIGNING_KEY` is missing (mirrors the `STRIPE_SECRET_KEY`
  sentinel). Lives in `packages/api/src/index.ts`, which consent Phase 2 (#1044) is
  actively editing — left to that PR to avoid a conflict.
- **Item 3** — the `signingKeyId → key` registry for rotation.
- **Item 4** — an integration test asserting `recordSignature` is non-null under a
  configured key, and that boot throws when unconfigured.

Once item 2 lands, add `CONSENT_SIGNING_KEY` to **`deploy.yml`**'s required-secret
presence loop so a missing key fails the deploy loudly instead of silently writing
unsigned rows.
