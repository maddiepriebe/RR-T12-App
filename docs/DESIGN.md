# Design Guidelines — RR-T12-App

## Aesthetic Direction

**Refined institutional.** Navy and gold — Arel Capital's brand colors. Dense, data-forward, precise. Feels like a professional internal tool, not a consumer app. Clean white surfaces, dark nav header, color used surgically for status only.

---

## Color System

Defined in `app/globals.css` as CSS variables. **Never hardcode hex values in components — use Tailwind classes that map to these.**

```css
--navy-950: #061629   /* sidebar / nav background */
--navy-900: #0a2240
--navy-800: #10304d   /* table headers */
--navy-700: #1a3f5f   /* primary button bg */
--gold-500: #eebb38   /* active nav, gold button, accents */
--gold-400: #f1c757   /* gold hover states */
```

**Page background:** `bg-slate-50` (#f8fafc)
**Surface / cards:** white (`bg-white`)
**Body text:** `#1a1a2e` (near-black)
**Borders:** `border-gray-200` or `border-gray-100`

**Status colors (standard Tailwind — no custom vars needed):**
- Error: `text-red-600`, `bg-red-50`, `border-red-200`
- Warning: `text-amber-600`, `bg-amber-50`
- Success: `text-green-600`, `bg-green-50`
- Info: `text-blue-600`, `bg-blue-50`

---

## Typography

**Font:** Inter (loaded in `globals.css` via Google Fonts, already applied to `body`)

- Page titles: `text-xl font-bold text-gray-900`
- Section headers: `.section-header` (class already defined — use it)
- Table headers: `text-xs font-semibold uppercase tracking-wider text-white` (inside `.finance-table th`)
- Table body: `text-sm text-gray-700`
- Labels: `text-sm font-medium text-gray-700`
- Muted/secondary text: `text-sm text-gray-500`
- Financial figures: right-aligned, use `tabular-nums` for numeric columns that need alignment

---

## Existing Utility Classes (use these — don't recreate)

All defined in `app/globals.css`:

### `.finance-table`
Standard financial data table. Apply to `<table>`.
- Headers: navy-800 bg, white text, small caps
- Body rows: `px-3 py-1.5`, bottom border
- Even rows: light gray bg
- `.row-subtotal` on `<tr>`: semibold, light navy bg, top border
- `.row-total` on `<tr>`: bold, stronger navy bg, thick top border
- `.row-header` on `<tr>`: uppercase category separator row

### `.upload-zone`
Drag-and-drop target. Apply to the drop container div.
- Default: dashed gray border, light bg
- `.drag-active`: gold border, gold-tinted bg
- `.has-file`: green border, green-tinted bg

### `.btn-primary`
Navy button. `bg-navy-700 hover:bg-navy-800 text-white font-semibold px-6 py-2.5 rounded-lg`

### `.btn-gold`
Gold button. `bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold px-6 py-2.5 rounded-lg`

### `.btn-outline`
Outlined button. `border-2 border-navy-700 text-navy-700 hover:bg-navy-700 hover:text-white`

### `.card`
`bg-white rounded-xl shadow-sm border border-gray-200 p-6`

### `.section-header`
`text-xs font-bold uppercase tracking-widest text-navy-600 mb-3`

---

## Layout Pattern

All pages use the same structure:
```
<NavBar />                         ← sticky top, always present
<main className="...">             ← page content, max-w-7xl mx-auto px-4 sm:px-6
  [page header]
  [content]
</main>
```

- No nested sidebars inside pages (only the top NavBar)
- Page-level padding: `py-8 px-4 sm:px-6 lg:px-8`
- Max content width: `max-w-7xl`
- Cards within pages: `.card` with internal padding, no page-level card wrapping

---

## Component Patterns

### Upload Zones
- Use `UploadZone` from `@/components/rediq/UploadZone` when possible
- Or apply `.upload-zone` class manually with react-dropzone
- Show file name once selected; show check icon or green state

### Progress Steps
- Use `ProgressIndicator` from `@/components/shared/ProgressIndicator`
- Steps: `{ label: string, status: "pending" | "active" | "done" | "error" }`
- Always show during async processing — never a blank loading state

### Financial Tables
- Use `.finance-table` class on `<table>`
- Subtotal rows: add `row-subtotal` class to `<tr>`
- Total rows (NOI, Net Income): add `row-total` class to `<tr>`
- Category headers (Income, Expenses): add `row-header` class to `<tr>`
- Right-align all numeric columns: `text-right`

### Status Badges
```tsx
// Report type badge
<span className="px-2 py-0.5 rounded text-xs font-medium bg-navy-100 text-navy-700">
  T12
</span>

// Processing status
<span className="text-green-600 text-sm font-medium">✓ Complete</span>
<span className="text-red-600 text-sm font-medium">✗ Error</span>
```

### Modals
- Backdrop: `fixed inset-0 bg-black/50 z-50 flex items-center justify-center`
- Modal panel: `bg-white rounded-xl shadow-xl p-6 w-full max-w-md`
- Close on backdrop click; Escape key optional

### Empty States
- Center in the content area
- Pattern: icon (optional) + heading + short description + CTA button
- Example: "No reports yet — upload a T12 to get started" + `.btn-primary` button

---

## Do Not

- Do not use purple, teal, or gradient backgrounds
- Do not use rounded corners >12px on cards (use `rounded-xl` max)
- Do not use heavy drop shadows — `.card` shadow-sm is the ceiling
- Do not use toast notifications for errors — show inline error states
- Do not truncate financial figures — always show the full formatted number
- Do not use placeholder text as form labels
- Do not add new fonts — Inter is already loaded and is the only font in use
- Do not use zebra striping outside `.finance-table` (it handles this itself)

---

## Number Formatting

**Use `Intl.NumberFormat` inline or extract to a shared utility.** No custom library needed.

```ts
// Currency (no cents)
new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
// → "$1,234,567"

// Currency with cents
new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)
// → "$1,234.56"

// Percentage
`${v.toFixed(1)}%`

// Per unit (e.g., trade-out)
`${v > 0 ? "+" : ""}${v.toFixed(1)}%`
```

If number formatting is used in 3+ places, extract to `lib/formatters.ts`.
Null values: always display as `"—"` (em dash), never blank or "null".