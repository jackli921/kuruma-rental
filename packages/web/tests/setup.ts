import '@testing-library/jest-dom/vitest'

// happy-dom has no ResizeObserver; libraries that measure their container (e.g.
// react-calendar-timeline's resize detector) need it. A no-op stub is enough for
// jsdom-style tests — nothing here asserts on observed sizes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
