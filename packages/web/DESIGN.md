# Kuruma Web Design System

> Source of truth for visual consistency across the web package. All sessions building UI must follow these rules.

## Theme Tokens

All colors, radii, and spacing are defined as CSS custom properties in `src/app/globals.css` using the **shadcn/ui neutral** palette (oklch). Never use raw hex/rgb values for UI chrome -- use the semantic tokens below.

### Color Usage

| Token | When to use |
|-------|-------------|
| `primary` | Primary actions (submit, confirm), nav active state |
| `secondary` | Secondary actions, subtle backgrounds |
| `muted` | Disabled states, placeholder backgrounds, subdued text |
| `destructive` | Delete, cancel, error states |
| `accent` | Hover backgrounds, highlighted rows, subtle emphasis |
| `card` | Card surfaces, elevated containers |
| `popover` | Dropdowns, tooltips, floating UI |
| `border` | All borders, dividers |
| `input` | Form input borders |
| `ring` | Focus rings (outline) |

**Brand accent**: For marketing/landing pages only, use `text-red-600` / `bg-red-600` (vermillion) as a warm accent. This is NOT used in app chrome -- only on public-facing pages.

### Dark Mode

- Supported via `.dark` class on `<html>`
- Not toggled by user in MVP -- follows system preference (future: manual toggle)
- All components must work in both modes using `dark:` variants
- Never hardcode `bg-white` or `text-black` -- use `bg-background` / `text-foreground`

## Typography

| Element | Classes | Notes |
|---------|---------|-------|
| Page title (h1) | `text-3xl font-semibold tracking-tight` | One per page |
| Section heading (h2) | `text-2xl font-semibold tracking-tight` | |
| Subsection (h3) | `text-xl font-medium` | |
| Body | `text-base` (default) | |
| Small / caption | `text-sm text-muted-foreground` | |
| Label | `text-sm font-medium` | Form labels |
| Code / mono | `font-mono text-sm` | |

**Fonts**: Geist Sans (body) + Geist Mono (code), loaded via `next/font/google` in locale layout. No other fonts.

## Spacing

| Context | Value | Notes |
|---------|-------|-------|
| Page padding (mobile) | `px-4` | |
| Page padding (desktop) | `px-6` or `px-8` | |
| Section gap | `py-16` or `py-24` | Between major page sections |
| Card padding | `p-6` | Consistent card interior |
| Form field gap | `gap-4` | Between form fields |
| Button gap (inline) | `gap-2` or `gap-3` | Between adjacent buttons |
| Max content width | `max-w-7xl mx-auto` | Page content container |
| Max prose width | `max-w-2xl` | Long-form text |

## Components

**Always use shadcn/ui components** from `@/components/ui/` for:
- Buttons, inputs, labels, cards
- Any new component: add via `bunx shadcn@latest add <component>`

**Never**:
- Use raw `<button>` without the Button component
- Create custom input styles that diverge from the Input component
- Add component libraries that overlap with shadcn (no Material UI, Chakra, etc.)

### Button Variants

| Variant | When to use |
|---------|-------------|
| `default` | Primary actions |
| `secondary` | Secondary actions |
| `outline` | Tertiary actions, less emphasis |
| `ghost` | Inline actions, nav items, icon buttons |
| `destructive` | Delete, remove, destructive actions |
| `link` | Inline text links styled as buttons |

## Layout Patterns

### Page Structure
```tsx
<main className="flex-1">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    {/* page content */}
  </div>
</main>
```

### Card Grid
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
  {/* cards */}
</div>
```

### Form Layout
```tsx
<form className="space-y-4 max-w-md">
  {/* fields */}
</form>
```

## Icons

Use **Lucide React** (`lucide-react`) -- already configured as shadcn icon library. Import individual icons:
```tsx
import { Car, Calendar, MessageSquare } from 'lucide-react'
```

Size conventions:
- Inline with text: `size={16}` or `className="size-4"`
- Standalone / nav: `size={20}` or `className="size-5"`
- Hero / feature: `size={24}` or `className="size-6"`

## Animations

- **Transitions**: Use `transition-colors` or `transition-all duration-200` for hover/focus states
- **Page transitions**: None in MVP (keep it simple)
- **Loading states**: Use skeleton placeholders, not spinners (add shadcn Skeleton when needed)

## Responsive Breakpoints

Follow Tailwind defaults: `sm:640px`, `md:768px`, `lg:1024px`, `xl:1280px`

- Mobile-first: write base styles for mobile, add `sm:` / `md:` / `lg:` for larger
- Nav collapses to hamburger at `md:` breakpoint
- Grid columns: 1 (mobile) -> 2 (sm) -> 3 (lg)

## Accessibility

- All interactive elements must be keyboard accessible
- Images need `alt` text
- Form inputs need associated `<Label>` components
- Color contrast must meet WCAG AA (the shadcn neutral theme handles this)
- Use semantic HTML (`<nav>`, `<main>`, `<section>`, `<header>`, `<footer>`)
