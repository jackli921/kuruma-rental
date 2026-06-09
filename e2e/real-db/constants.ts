// Dependency-free so playwright.real-db.config.ts can import the storageState
// path without pulling the minting chain (postgres, next-auth) into config load.

// Operator (OPERATOR_OWNER) session — the project-level default storageState.
export const STORAGE_STATE = 'e2e/.auth/operator.json'
export const OPERATOR_STORAGE_STATE = STORAGE_STATE

// Renter (RENTER) session — the marketplace happy-path spec attaches this to a
// second browser context so steps 1-5 run as the booking renter (#390).
export const RENTER_STORAGE_STATE = 'e2e/.auth/renter.json'
