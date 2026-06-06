/// <reference types="vite/client" />

// Typed access to the client env baked in at build time (spec §7.3). Only the
// Vite app sees this (frozen tsconfig.json excludes src/vite/**), so the Next
// app keeps process.env.* typing.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
