---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-04-18
---
# React Force Graph — Local Graph Pattern

## Purpose
Pattern for rendering Obsidian-style local force-directed graphs in the OmniFrame web app using `react-force-graph-2d`.

## Library
`react-force-graph-2d@1.29.1` (~30 KB gz). Canvas-based, d3-force physics.

## Component Pattern

```tsx
function LocalGraph({ graph, loading, onNodeClick }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<any>(undefined)
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 })
  // ResizeObserver for responsive sizing
  // useMemo for graphData (nodes + links from raw graph payload)
  // Custom nodeCanvasObject for color-by-type, glow on focus node
  // zoomToFit on data change
}
```

## Key Decisions

1. **TypeScript:** Library types are complex with nested generics. Use `any` for ref and cast `ForceGraph2D as any` for props to avoid deep type gymnastics.
2. **Node sizing:** Based on degree (edge count). Focus node is 1.5x.
3. **Node colors:** Stable map per entity type (TO=indigo, Material=amber, Bin=emerald, Delivery=blue, User=violet, Movement=pink).
4. **Dark canvas:** `bg-black/30` container, transparent graph background. White text labels.
5. **Interactivity:** Click non-focus node → triggers refocus callback (new query with changed focus type + ID).
6. **Performance:** `cooldownTicks={80}` to prevent infinite physics simulation. `zoomToFit` after 300ms delay.
7. **Responsive:** `ResizeObserver` on container, passes width/height to `ForceGraph2D`.

## Reuse Guidelines

Any feature that has a node + edge payload can use this pattern:
- TO History (LT24) — current user
- Future: Delivery network, material flow, org structure
- Just provide `{ nodes: [{id, type, label}], edges: [{source, target, relation}], focus: {type, id} }`

## Related
- [[LT24 - Transfer Order History]]
- [[Implementation - Implement-TO-History-Tab]]