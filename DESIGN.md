# Design System

Source of truth for visual consistency. Every agent/model building UI must follow this.

## Stack

- **Tailwind CSS v4** (CSS-first config via `globals.css`, no `tailwind.config.ts`)
- **shadcn/ui components** in `packages/web/src/components/ui/`
- **base-ui primitives** (headless, unstyled) — shadcn wraps these
- **CVA** (class-variance-authority) for component variants
- **Geist / Geist Mono** fonts

## Colors: Use Semantic Tokens Only

**NEVER use raw Tailwind colors** (`zinc-50`, `gray-900`, `blue-500`, etc.) in components or pages.
**ALWAYS use the semantic tokens** from `globals.css`. They handle light/dark mode automatically.

| Use this | Not this | Purpose |
|----------|----------|---------|
| `bg-background` | `bg-white`, `bg-zinc-50` | Page/section background |
| `text-foreground` | `text-black`, `text-zinc-900` | Primary text |
| `text-muted-foreground` | `text-zinc-600`, `text-gray-500` | Secondary/helper text |
| `bg-card` / `text-card-foreground` | `bg-white`, `text-black` | Card surfaces |
| `bg-primary` / `text-primary-foreground` | `bg-zinc-900` | Buttons, emphasis |
| `bg-secondary` / `text-secondary-foreground` | `bg-zinc-100` | Secondary actions |
| `bg-muted` / `text-muted-foreground` | `bg-gray-100` | Subdued backgrounds |
| `bg-accent` / `text-accent-foreground` | `bg-zinc-100` | Hover states, highlights |
| `bg-destructive` / `text-destructive` | `bg-red-500` | Errors, danger |
| `border-border` | `border-zinc-200` | Default borders |
| `border-input` | `border-gray-300` | Form input borders |
| `ring-ring` | `ring-zinc-400` | Focus rings |

## Radius

Base radius: `0.625rem`. Use Tailwind's radius scale which derives from `--radius`:

| Token | Use for |
|-------|---------|
| `rounded-sm` | Small pills, tags |
| `rounded-md` | Inputs, small buttons |
| `rounded-lg` | Buttons (default), cards inner elements |
| `rounded-xl` | Cards, modals |

## Spacing Conventions

| Context | Pattern |
|---------|---------|
| Page padding | `px-4` mobile, `px-16` desktop |
| Card internal | `p-4` default, `p-3` for `size="sm"` |
| Section gaps | `gap-6` between major sections |
| Element gaps | `gap-1.5` between related elements |
| Max content width | `max-w-3xl` for readable text, `max-w-6xl` for dashboards |

## Typography

| Element | Classes |
|---------|---------|
| Page title (h1) | `text-3xl font-semibold tracking-tight` |
| Section title (h2) | `text-xl font-semibold` |
| Card title | Use `<CardTitle>` component (`text-base font-medium`) |
| Body text | `text-sm` (default in cards), `text-base` (standalone) |
| Helper text | `text-sm text-muted-foreground` |
| Mono/code | `font-mono` |

## Components: Use Existing UI Primitives

Before creating custom UI, check `packages/web/src/components/ui/`:

| Component | Variants | Notes |
|-----------|----------|-------|
| `Button` | default, outline, secondary, ghost, destructive, link | Sizes: xs, sm, default, lg, icon |
| `Card` | default, sm | With CardHeader, CardTitle, CardContent, CardFooter |
| `Input` | — | Uses base-ui primitive, h-8 default |
| `Label` | — | For form fields |
| `Avatar` | — | User avatars |
| `DropdownMenu` | — | For menus |
| `Separator` | — | Horizontal/vertical dividers |

**If a shadcn component exists, use it. Don't rebuild from scratch.**

## Dark Mode

- Uses `.dark` class strategy (not media query)
- All semantic tokens auto-switch — this is why you must use them
- For one-off dark overrides: `dark:` prefix (e.g., `dark:bg-input/30`)

## Anti-Patterns

```tsx
// WRONG: Raw colors break dark mode and drift across agents
<div className="bg-white text-black border-gray-200">
<p className="text-zinc-600">

// RIGHT: Semantic tokens, consistent everywhere
<div className="bg-background text-foreground border-border">
<p className="text-muted-foreground">

// WRONG: Custom button styles
<button className="bg-blue-600 text-white rounded-md px-4 py-2">

// RIGHT: Use the Button component
<Button variant="default" size="default">

// WRONG: Hardcoded font
<h1 className="font-['Inter']">

// RIGHT: Use the configured font variable
<h1 className="font-sans">
```
