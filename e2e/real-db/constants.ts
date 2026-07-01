// Dependency-free so playwright.real-db.config.ts can import the storageState
// path without pulling the minting chain (postgres, next-auth) into config load.

// Operator (OPERATOR_OWNER) session — the project-level default storageState.
export const STORAGE_STATE = 'e2e/.auth/operator.json'

// Renter (RENTER) session — the marketplace happy-path spec attaches this to a
// second browser context so steps 1-5 run as the booking renter (#390).
export const RENTER_STORAGE_STATE = 'e2e/.auth/renter.json'

// Platform-admin (PLATFORM_ADMIN) session — the demo walkthrough attaches this
// to a third context so it can capture the env-gated /admin/revenue tab (#462).
export const ADMIN_STORAGE_STATE = 'e2e/.auth/admin.json'

// The seed grants this email PLATFORM_ADMIN when it appears in PLATFORM_ADMIN_EMAILS
// (seed.ts §3). SINGLE SOURCE OF TRUTH: the local runner + mint-session read it
// here so the seeded admin and the minted token never drift. The CI workflow
// duplicates the literal in ci.yml's seed step (yaml can't import TS) — keep them
// in sync.
export const ADMIN_SEED_EMAIL = 'platform-admin@kuruma.test'

// Seeded-persona emails mint-session resolves to a DB user id + tenant. These
// MIRROR the shared seed (@kuruma/shared db/constants BEST_CAR_RENTAL_OWNER_EMAIL
// and seed-data/bookings.ts DEMO_RENTERS — Sarah Smith, en) but are re-declared here rather than
// imported: Playwright's loader transpiles this test dir, not arbitrary
// packages/shared/**.ts reached via import (same constraint that keeps the JWT
// minting inlined in mint-session.ts). Single source WITHIN e2e — change here.
export const OPERATOR_SEED_EMAIL = 'owner@best-car-rental.local'
export const RENTER_SEED_EMAIL = 'sarah@example.test'

// Second seeded operator (Kansai Drive) — MIRRORS shared db/constants.ts
// SECOND_OPERATOR_OWNER_EMAIL / SECOND_OPERATOR_NAME (seed-data/operators.ts §2),
// re-declared here under the same Playwright-loader constraint as the personas
// above. Used by tenant-isolation.auth.spec.ts as "operator B" — a distinct
// tenant from Best Car Rental (operator A) that must never see A's data.
export const SECOND_OPERATOR_SEED_EMAIL = 'owner@kansai-drive.example.test'
export const SECOND_OPERATOR_OWNER_NAME = 'Kansai Drive Owner'
