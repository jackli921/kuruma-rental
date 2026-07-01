// Public surface of the messaging feature (#1205). Cross-feature consumers
// (routes, nav, the bookings views) import from `@/vite/messaging`, not the
// internal files — see docs/architecture/modules.md and the #1110 reach-in
// ratchet. Intra-feature code keeps importing the sibling files directly.
export * from './api'
export * from './booking-threads'
export * from './unread-badge'
export { ConversationView } from './ConversationView'
export { MessageHostLink } from './MessageHostLink'
export { OperatorInboxView } from './OperatorInboxView'
export { ThreadListView } from './ThreadListView'
