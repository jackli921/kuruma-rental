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
        // #622: interaction-state parity with ui/input.tsx (focus / disabled /
        // aria-invalid + their dark variants). The select keeps its own h-9
        // rounded-md dimensions and bg-transparent resting state — only the
        // missing interaction-state styling is harmonized.
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
