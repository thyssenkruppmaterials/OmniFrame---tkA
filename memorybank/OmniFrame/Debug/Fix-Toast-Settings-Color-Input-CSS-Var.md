---
tags: [type/debug, status/active, domain/frontend]
created: 2026-06-11
---

# Fix-Toast-Settings-Color-Input-CSS-Var

## Purpose / Context

Console warnings (3×, persisting across SPA navigation so they appear
"on" unrelated pages like `/admin/supply-chain-mapping`):

```
The specified value "var(--card)" does not conform to the required format.
The format is "#rrggbb" …   (also --card-foreground, --border)
```

Chrome's chunk attribution pointed at `feature-supply-chain-3d`, which was
a red herring — the 3D harness reproduces zero such warnings. The triple
of tokens matched `DEFAULT_TOAST_SETTINGS.priorities.*` exactly:
`backgroundColor: 'var(--card)'`, `textColor: 'var(--card-foreground)'`,
`borderColor: 'var(--border)'` (`src/lib/services/settings-service.ts`).

## Root cause

`ToastNotificationSettings-Enhanced.tsx` (System Settings → Toast tab)
binds those raw settings values into `<Input type='color' …>`. A color
input accepts ONLY `#rrggbb`; anything else logs the warning and coerces
the swatch to black. Storing `var(--token)` in settings is intentional
(toasts should follow the theme) — only the *picker binding* was wrong.

## Fix

New `cssColorToHex()` in `src/lib/utils/css-color.ts` (cached): resolves
any CSS color expression to `#rrggbb` by (1) computing it on a hidden
probe `<span style="color: …">` in the live document (resolves `var()`
against the current theme), then (2) normalizing the computed value
through a 1×1 canvas (`fillStyle` → `getImageData`), which collapses any
color space (rgb/oklch/color()) to sRGB bytes. The four color inputs now
bind `value={cssColorToHex(config.X)}`; the paired free-text inputs stay
raw so `var(--token)` round-trips unchanged. 2 unit tests (hex
passthrough + non-resolvable fallback — jsdom has no 2d context).

## Diagnostic lesson

Chrome console source attribution for DOM property warnings can point at
an unrelated lazy chunk; trust the *message payload* (which values?) over
the *blamed file*, and grep for the value triple.

## Related

- [[Build-Supply-Chain-Mapping-3D]] (where it was first noticed)
- [[Fix-Supply-Chain-WebGPU-Resize-Mismatch]]
