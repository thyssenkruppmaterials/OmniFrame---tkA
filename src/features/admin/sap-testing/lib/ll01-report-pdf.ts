/**
 * LL01 Warehouse Activity Report — PDF generator (2026-06-01).
 *
 * Renders a print-optimised, self-contained HTML document and prints it via a
 * hidden iframe so the user gets the browser "Save as PDF" flow. No PDF library
 * (keeps the bundle budget intact) and full CSS control = pixel-perfect output
 * that mirrors the on-screen heatmap colours. The iframe avoids popup blockers
 * and style bleed from the app.
 */
import {
  LL01_SEVERITY_COLORS,
  ll01ReportFilenameStem,
  type LL01ReportAgingSection,
  type LL01ReportModel,
} from './ll01-report'

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Share-based tint for an aging-bucket count (0 = none, higher share = hotter). */
function bucketTint(count: number, denom: number): string {
  if (count === 0 || denom === 0) return '#f8fafc'
  const pct = count / denom
  if (pct < 0.05) return LL01_SEVERITY_COLORS.green.bg
  if (pct < 0.2) return LL01_SEVERITY_COLORS.amber.bg
  return LL01_SEVERITY_COLORS.red.bg
}

function renderHeatmap(model: LL01ReportModel): string {
  const head = `
    <tr>
      <th class="cat">Category</th>
      ${model.plants.map((p) => `<th class="num">${esc(p)}</th>`).join('')}
      <th class="num total-col">Total</th>
    </tr>`
  const body = model.heatmap
    .map((row) => {
      const cells = row.cells
        .map((c) => {
          const col = LL01_SEVERITY_COLORS[c.severity]
          return `<td class="num" style="background:${col.bg};color:${col.text};">${fmtNum(
            c.count
          )}</td>`
        })
        .join('')
      const rc = LL01_SEVERITY_COLORS[row.severity]
      return `<tr>
        <td class="cat">${esc(row.label)}</td>
        ${cells}
        <td class="num total-col"><span class="chip" style="background:${rc.bg};color:${rc.text};border-color:${rc.border};">${fmtNum(
          row.total
        )}</span></td>
      </tr>`
    })
    .join('')
  const totalsRow = `
    <tr class="grand">
      <td class="cat">Total</td>
      ${model.plantTotals
        .map((p) => `<td class="num">${fmtNum(p.total)}</td>`)
        .join('')}
      <td class="num total-col">${fmtNum(model.grandTotal)}</td>
    </tr>`
  return `
    <table class="grid heatmap">
      <thead>${head}</thead>
      <tbody>${body}${totalsRow}</tbody>
    </table>`
}

function renderAgingSection(
  section: LL01ReportAgingSection,
  supportsAging: boolean
): string {
  const userNote = section.userField
    ? `Top users by <code>${esc(section.userField)}</code>`
    : 'No user column for this category'

  if (!supportsAging) {
    return `
      <section class="card">
        <div class="card-head"><span class="accent"></span><h3>${esc(
          section.label
        )}</h3><span class="muted">${fmtNum(section.totalRecords)} records</span></div>
        <p class="note">Aging breakdown requires a current (v2) agent run. Re-run the Warehouse Activity Monitor to populate per-record aging.</p>
      </section>`
  }

  const rows = section.byPlant
    .map((b) => {
      const c30 = bucketTint(b.gt30, b.dated)
      const c60 = bucketTint(b.gt60, b.dated)
      const c90 = bucketTint(b.gt90, b.dated)
      return `<tr>
        <td class="cat">${esc(b.plant)}</td>
        <td class="num" style="background:${c30};">${fmtNum(b.gt30)}</td>
        <td class="num" style="background:${c60};">${fmtNum(b.gt60)}</td>
        <td class="num" style="background:${c90};">${fmtNum(b.gt90)}</td>
        <td class="num muted">${fmtNum(b.dated)}</td>
        <td class="num muted">${fmtNum(b.undated)}</td>
      </tr>`
    })
    .join('')
  const t = section.totals
  const totalsRow = `<tr class="grand">
      <td class="cat">Total</td>
      <td class="num">${fmtNum(t.gt30)}</td>
      <td class="num">${fmtNum(t.gt60)}</td>
      <td class="num">${fmtNum(t.gt90)}</td>
      <td class="num">${fmtNum(t.dated)}</td>
      <td class="num">${fmtNum(t.undated)}</td>
    </tr>`

  const usersBlock = section.userField
    ? section.topUsers.length > 0
      ? `<table class="grid mini">
           <thead><tr><th class="cat">User</th><th class="num">Records</th></tr></thead>
           <tbody>${section.topUsers
             .map(
               (u) =>
                 `<tr><td class="cat">${esc(u.user)}</td><td class="num">${fmtNum(
                   u.count
                 )}</td></tr>`
             )
             .join('')}</tbody>
         </table>`
      : `<p class="note">No user IDs on the current records.</p>`
    : `<p class="note">Not available for this category.</p>`

  const quartersBlock =
    section.quarters.length > 0
      ? `<div class="quarters">${section.quarters
          .map(
            (q) =>
              `<span class="q"><b>${esc(q.quarter)}</b> ${fmtNum(q.total)}</span>`
          )
          .join('')}</div>`
      : `<p class="note">No dated records to chart by quarter.</p>`

  return `
    <section class="card">
      <div class="card-head">
        <span class="accent"></span>
        <h3>${esc(section.label)}</h3>
        <span class="muted">${fmtNum(section.totalRecords)} records · aged by <code>${esc(
          section.anchorKey.replace(/_/g, ' ')
        )}</code>${
          section.span
            ? ` · ${esc(section.span.oldest)} → ${esc(section.span.newest)}`
            : ''
        }</span>
      </div>
      <div class="aging-grid">
        <div>
          <h4>Plant × aging (cumulative)</h4>
          <table class="grid">
            <thead><tr><th class="cat">Plant</th><th class="num">&gt;30d</th><th class="num">&gt;60d</th><th class="num">&gt;90d</th><th class="num">Dated</th><th class="num">Undated</th></tr></thead>
            <tbody>${rows}${totalsRow}</tbody>
          </table>
          <h4>By quarter</h4>
          ${quartersBlock}
        </div>
        <div>
          <h4>${userNote}</h4>
          ${usersBlock}
        </div>
      </div>
    </section>`
}

export function renderLL01ReportHtml(model: LL01ReportModel): string {
  const span = (() => {
    const labels = model.aging
      .flatMap((s) => (s.span ? [s.span.oldest, s.span.newest] : []))
      .sort()
    return labels.length > 0
      ? `${labels[0]} → ${labels[labels.length - 1]}`
      : '—'
  })()

  const stats = [
    { label: 'Plants', value: String(model.plants.length) },
    { label: 'Total flagged records', value: fmtNum(model.totalRecords) },
    { label: 'Categories', value: String(model.heatmap.length) },
    { label: 'Aging data span', value: span },
  ]

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Warehouse Activity Monitor — LL01</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a; font-size: 11px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 14px; border-bottom: 3px solid #4f46e5; margin-bottom: 16px;
  }
  .brand { display:flex; align-items:center; gap:10px; }
  .header h1 { font-size: 18px; margin: 0; letter-spacing: -.3px; }
  .header .sub { color:#64748b; font-size: 11px; margin-top: 2px; }
  .header .right { text-align: right; color:#64748b; font-size: 10px; }
  .header .right b { color:#0f172a; }
  .stats { display:flex; gap: 10px; margin-bottom: 18px; }
  .stat { flex:1; border:1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background:#f8fafc; }
  .stat .v { font-size: 18px; font-weight: 800; letter-spacing:-.4px; color:#1e293b; }
  .stat .l { font-size: 9px; text-transform: uppercase; letter-spacing:.6px; color:#64748b; margin-top: 2px; }
  h2.section { font-size: 13px; margin: 8px 0 8px; padding-left: 9px; border-left: 4px solid #4f46e5; }
  table.grid { width:100%; border-collapse: collapse; margin: 4px 0 10px; }
  table.grid th, table.grid td { border: 1px solid #e2e8f0; padding: 5px 7px; }
  table.grid thead th { background:#1e293b; color:#fff; font-weight:600; font-size: 10px; text-align:center; }
  table.grid thead { display: table-header-group; }
  table.grid th.cat, table.grid td.cat { text-align:left; font-weight:600; }
  table.grid td.cat { font-weight:500; }
  table.grid .num { text-align:center; font-variant-numeric: tabular-nums; }
  table.grid .total-col { font-weight:700; }
  table.grid tr.grand td { background:#f1f5f9; font-weight:800; border-top:2px solid #cbd5e1; }
  table.grid .muted { color:#94a3b8; }
  .chip { display:inline-block; min-width: 30px; padding: 1px 7px; border-radius: 999px; border:1px solid; font-weight:700; }
  .heatmap td.cat { width: 34%; }
  .card { border:1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid; }
  .card-head { display:flex; align-items:center; gap:9px; margin-bottom: 8px; }
  .card-head .accent { width:6px; height:18px; border-radius:3px; background:#4f46e5; }
  .card-head h3 { font-size: 13px; margin:0; }
  .card-head .muted { color:#64748b; font-size: 10px; margin-left:auto; }
  .aging-grid { display:grid; grid-template-columns: 1.55fr 1fr; gap: 14px; }
  h4 { font-size: 10px; text-transform: uppercase; letter-spacing:.5px; color:#475569; margin: 6px 0 3px; }
  table.mini th, table.mini td { padding: 3px 7px; }
  .quarters { display:flex; flex-wrap:wrap; gap:5px; }
  .quarters .q { border:1px solid #e2e8f0; border-radius: 6px; padding: 2px 7px; font-size:10px; background:#f8fafc; }
  .quarters .q b { color:#4f46e5; }
  .note { color:#94a3b8; font-style: italic; font-size: 10px; margin: 4px 0; }
  code { background:#f1f5f9; padding: 0 4px; border-radius: 4px; font-size: 10px; }
  .footer { margin-top: 14px; padding-top: 8px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size: 9px; text-align:center; }
  @media print { .card { box-shadow:none; } }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div>
        <h1>Warehouse Activity Monitor</h1>
        <div class="sub">LL01 — stuck / critical warehouse conditions · OmniFrame</div>
      </div>
    </div>
    <div class="right">
      <div>Run: <b>${esc(fmtDate(model.ranAt))}</b></div>
      <div>Generated: <b>${esc(fmtDate(model.generatedAt))}</b></div>
      ${model.agentId ? `<div>Agent: <b>${esc(model.agentId)}</b></div>` : ''}
    </div>
  </div>

  <div class="stats">
    ${stats
      .map(
        (s) =>
          `<div class="stat"><div class="v">${esc(s.value)}</div><div class="l">${esc(
            s.label
          )}</div></div>`
      )
      .join('')}
  </div>

  <h2 class="section">Plant × Category Heatmap</h2>
  ${renderHeatmap(model)}

  <h2 class="section">Aging by Category</h2>
  ${model.aging.map((s) => renderAgingSection(s, model.supportsAging)).join('')}

  <div class="footer">OmniFrame · Warehouse Activity Monitor (LL01) · ${esc(
    ll01ReportFilenameStem(model)
  )}</div>
</body>
</html>`
}

/** Build the report HTML and print it via a hidden iframe → "Save as PDF". */
export function generateLL01Pdf(model: LL01ReportModel): void {
  const html = renderLL01ReportHtml(model)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'
  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => {
      try {
        document.body.removeChild(iframe)
      } catch {
        /* already removed */
      }
    }, 1500)
  }

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  const win = iframe.contentWindow
  if (!doc || !win) {
    cleanup()
    throw new Error('Could not open a print frame for the report.')
  }
  doc.open()
  doc.write(html)
  doc.close()
  // Give the frame a tick to lay out fonts/tables before printing.
  window.setTimeout(() => {
    try {
      win.focus()
      win.print()
    } finally {
      cleanup()
    }
  }, 350)
}
