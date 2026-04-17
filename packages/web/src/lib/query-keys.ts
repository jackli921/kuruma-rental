export const vehicleKeys = {
  all: ['vehicles'] as const,
  fleetOverview: ['vehicles', 'fleet-overview'] as const,
} as const

export const messageKeys = {
  all: ['messages'] as const,
  threads: () => [...messageKeys.all, 'threads'] as const,
  thread: (id: string) => [...messageKeys.all, 'thread', id] as const,
  userNames: (ids: readonly string[]) =>
    [...messageKeys.all, 'user-names', [...ids].sort()] as const,
} as const
