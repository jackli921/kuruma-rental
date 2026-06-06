// Dependency-free so playwright.real-db.config.ts can import the storageState
// path without pulling the minting chain (postgres, next-auth) into config load.
export const STORAGE_STATE = 'e2e/.auth/operator.json'
