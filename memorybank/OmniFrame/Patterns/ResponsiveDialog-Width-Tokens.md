---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-16
---

# ResponsiveDialog Width Tokens

## Purpose / Context

**Ban `min-w-[Npx]` on `DialogContent`.** It forces horizontal *page* scroll under that width — the dialog refuses to shrink, so it pushes the viewport sideways instead of fitting inside it. This was the single most common dialog bug found in the 2026-05-16 responsive resize audit (twelve callsites; the worst was `min-w-[1200px]` which clipped the browser chrome at 1280-wide laptop displays).

`<ResponsiveDialog>` (in `src/components/ui/responsive-dialog.tsx`) replaces every hand-rolled wide dialog with a **size-token API** + a **three-slot Header/Body/Footer** convention. The body owns the only scrollport, so the header and footer can never scroll off-screen.

Introduced 2026-05-16 as part of the responsive resize sweep. See [[Implement-Responsive-Resize-Sweep-2026-05-16]] for the inventory of converted callsites.

## Size token API

```tsx
import {
  ResponsiveDialog,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'

<ResponsiveDialog open={open} onOpenChange={setOpen} size='xl'>
  <ResponsiveDialogHeader>
    <ResponsiveDialogTitle>Edit work order</ResponsiveDialogTitle>
  </ResponsiveDialogHeader>
  <ResponsiveDialogBody>
    {/* table, form, anything that might overflow */}
  </ResponsiveDialogBody>
  <ResponsiveDialogFooter>
    <Button variant='ghost' onClick={() => setOpen(false)}>Cancel</Button>
    <Button onClick={save}>Save</Button>
  </ResponsiveDialogFooter>
</ResponsiveDialog>
```

### Size → pixel mapping

| Size | Max width | Width class | Typical use |
|---|---|---|---|
| `sm` | 480 px | `w-[min(100vw-2rem,480px)]` | Confirmation / single-question dialogs. |
| `md` | 640 px | `w-[min(100vw-2rem,640px)]` | **Default.** Standard form dialogs. |
| `lg` | 900 px | `w-[min(100vw-2rem,900px)]` | Multi-section forms, modest data tables. |
| `xl` | 1280 px | `w-[min(100vw-2rem,1280px)]` | Wide tables, multi-column workbenches. **Use this for everything that used to be `min-w-[1200px]`.** |
| `full` | viewport − 2 rem | `w-[calc(100vw-2rem)]` | Edge-to-edge utility dialogs (image viewers, map pickers). |

### Why `w-[min(100vw-2rem,Npx)]` is the right pattern

The `min()` formula encodes two intents in one class:

- **At wide viewports**, the dialog caps at the token's max (e.g. 1280 px for `xl`) so it doesn't sprawl across an ultra-wide monitor.
- **At narrow viewports**, the dialog falls back to `100vw - 2rem` so it always leaves a small inset and *never* forces page scroll.

The `2rem` inset (16 px each side) matches Radix Dialog's default backdrop padding and gives the close-button hit target room to breathe on phones.

`min-w-[Npx]` does the opposite — it sets a *floor* on the width, which is exactly the failure mode we're banning. Under that floor the dialog refuses to shrink and the viewport scrolls horizontally.

## Three-slot convention

`<ResponsiveDialog>` composes a vertical flex column with exactly three slots, in this order:

1. **`<ResponsiveDialogHeader>`** — `shrink-0`, border-bottom, fixed. Holds the title + optional description.
2. **`<ResponsiveDialogBody>`** — `flex-1 min-h-0 min-w-0 overflow-y-auto`. **The only scrollport in the dialog.** Wide content (tables, forms with many columns) goes here with its own `overflow-x-auto` if needed.
3. **`<ResponsiveDialogFooter>`** — `shrink-0`, border-top, fixed. Holds action buttons; flips to `flex-col-reverse` on `sm:` so the primary action stays on the right at desktop and on top at mobile.

Outer `<DialogContent>` is `max-h-[90vh] flex flex-col overflow-hidden p-0` — the chrome is fixed, the body takes the remaining vertical space, and the body's `overflow-y-auto` is what scrolls.

### Why the body owns the scroll

The most common dialog-anti-pattern in the codebase before this sweep was putting `overflow-y-auto` on `DialogContent` itself. That makes the header *and* the footer scroll with the body, which means a long form looks fine on first render and then the Save/Cancel buttons disappear off the bottom as the user scrolls. Users either don't realise they can submit, or they scroll back up to find the X to close and abandon the workflow.

With the body slot owning the scroll, the header and footer stay glued. The user always sees the title (for context) and always sees the action buttons (for resolution).

## Don't

- **Don't add `min-w-[Npx]` to `DialogContent`.** Ever. There is no width below which a dialog cannot shrink — if you need it to *prefer* 1200 px, use `<ResponsiveDialog size='xl'>` and let the `min()` formula handle the narrow case.
- **Don't nest scrollports.** Put `overflow-y-auto` on the body slot only. If the body has a table that needs horizontal scroll, put `overflow-x-auto` on the table wrapper — don't add another vertical scroller inside the body.
- **Don't wrap `<ResponsiveDialog>` in another `<Dialog>`.** The component already composes `<Dialog>` internally. If you have your own `<Dialog>` root because you need a custom trigger, use `<ResponsiveDialogContent size='xl'>` standalone instead and keep your root.
- **Don't put `overflow-y-auto` on `DialogContent`.** Same anti-pattern as nested scrollports — header and footer scroll with the body, action buttons go off-screen.
- **Don't reach past the size tokens.** If you genuinely need a different max width (rare), add a new size key to the source file rather than passing `className='w-[1100px]'`. Keeps the wire shape consistent and lets the audit grep find every wide dialog.
- **Don't put `min-w-[Npx]` on a *child* of `DialogContent` either.** A wide table inside the body should be `min-w-full overflow-x-auto`, not `min-w-[1200px]` — the latter pushes the dialog wider than its own width class allows and re-creates the page-scroll bug at one level deeper.

## Related

- [[ADR-Container-Query-Stat-Tiles]] — sibling decision in the same sweep; same "primitive that bakes in the fix you keep forgetting" philosophy applied to KPI tiles.
- [[Responsive-StatTile-And-KpiGrid]] — the other 2026-05-16 primitive. Use `<KpiGrid>` inside `<ResponsiveDialogBody>` for KPI-driven detail dialogs.
- [[UI-Component-Conventions]] — broader shadcn primitive conventions; `<ResponsiveDialog>` follows the `data-slot` + size-token shape used by the rest of `src/components/ui/`.
