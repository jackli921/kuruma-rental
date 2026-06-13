import type * as React from 'react'

import { cn } from '@/lib/utils'

// Styled native <select> primitive (#604). Owns the shared border/height class
// string that was copy-pasted across the operator forms. This is a plain native
// select — distinct from the base-ui composite Select in ./select.tsx — so an
// RHF register() spreads straight onto it and each call site keeps its own
// options + setValueAs. Extra `className` merges on top via cn.
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
