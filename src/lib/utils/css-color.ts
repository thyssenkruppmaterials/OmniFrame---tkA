// Created and developed by Jai Singh
// Resolve any CSS color expression (hex, named, oklch(), var(--token), …)
// to a "#rrggbb" hex string. <input type="color"> accepts ONLY #rrggbb —
// binding theme tokens like 'var(--card)' to one makes Chrome log
// 'The specified value "var(--card)" does not conform to the required
// format' on every mount and silently coerce the swatch to black.

const HEX6 = /^#[0-9a-f]{6}$/i

const cache = new Map<string, string>()

export function cssColorToHex(value: string, fallback = '#000000'): string {
  if (HEX6.test(value)) return value
  if (typeof document === 'undefined') return fallback
  const cached = cache.get(value)
  if (cached) return cached

  // Resolve var()/named/relative colors against the live document theme…
  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = value
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  // …then let a 1×1 canvas normalize whatever color space the computed
  // value is in (rgb, oklch, color()) down to sRGB bytes.
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
  cache.set(value, hex)
  return hex
}
