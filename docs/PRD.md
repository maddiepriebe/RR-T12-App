# Product Requirements Document — RR-T12-App

## Overview

RR-T12-App (`arel-underwriting`) is an internal multifamily real estate underwriting platform for **Arel Capital**. It replicates and extends RedIQ's core functionality — replacing manual document processing with an automated, AI-assisted pipeline from raw deal documents to completed underwriting output, all inside a single web interface.

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, PostgreSQL (Neon), Drizzle ORM, Vercel Blob, Clerk (auth), Anthropic Claude API, PDF.js, xlsx

---

## Goals

1. Ingest raw deal documents (T12 Excel, rent roll Excel, CoStar PDFs) and extract structured data automatically
Acceptance Criteria: Achieve >= 90% field-level extraction accuracy on T12 and Rent Roll deterministic parsers; fallback on AI usage limited to <10% of files monhly. 
2. Standardize all parsed data into a consistent internal schema
3. Allow analysts to review, edit, and save parsed results per property
4. Generate downloadable Excel outputs in Arel Capital format
5. Maintain a searchable property library with attached reports

## Non-Goals (v1)

- Public-facing access / multi-tenant SaaS
- Mobile-native app
- Full proforma / DCF modeling (future phase)
- Deal pipeline kanban (future phase)

---

## User Roles

| Role | Access |
|---|---|
| Analyst | All features — upload docs, parse, review, download |
| (Future) Admin | Firm-wide property list, multi-user management |

All users are authenticated via Clerk. All authenticated users share a single property library — any user can see, upload to, and manage any property. There is no per-user data scoping. Auth is for access control only, not data filtering.

---

## Current Modules (built)

### 1. Properties

**Route:** `/properties`, `/properties/[id]`

A property is the top-level entity that all reports attach to. Users create properties with: name, address, city, state, zip, unit count.

The property detail page (`/properties/[id]`) shows all saved reports for that property (T12, rent roll, rent comps, trade-out), with inline previews and download links.

### 2. T12 Processing

**Routes:** `/t12`, `/api/rediq/process-t12`

- User uploads a T12 Excel file (`.xlsx` or `.xls` only — PDF not accepted)
- Server extracts text via `xlsx`
- Regex parser (`lib/t12-parser.ts`) attempts deterministic extraction first — no AI cost, no latency
- If regex returns fewer than 3 line items, Claude is called as a fallback with a structured system prompt
- Parsed output is standardized `T12Data` JSON (line items categorized as income/expense/noi)
- Each extracted line item is mapped to a canonical category from a predefined taxonomy
  (`lib/t12-categories.ts`); matching runs in three tiers — (1) database lookup of previously
  confirmed mappings, (2) fuzzy string match, (3) Claude fallback for ambiguous items.
  Resolved mappings are written back to the `t12_category_mappings` table with their source
  (`exact`, `fuzzy`, `llm`, `user`) and confirmation status, so the system improves with each
  processed file. Unmatched line items are flagged as `UNMAPPED` and highlighted in the UI.
- User can review and correct `UNMAPPED` or unconfirmed mappings via a dropdown in the UI;
  confirmed mappings are saved with `source = 'user'` and used as the highest-priority match
  in future processing.
- If Claude fallback was used, an amber banner displays: "AI extraction was used — verify line items"
- User can save the result to a property → stored in `reports` table with `processedData`;
  resolved category mappings stored in `t12_category_mappings` table

  **T12 Reconciliation View**

After initial parsing and auto-mapping, the user is presented with a reconciliation UI before saving:

- Table displays one row per line item with columns: Mapped Category | Original Label | Jan | Feb | ... | Dec | Total
- User designates the first expense row and the NOI row via row-level controls; this anchors
  the revenue/expense boundary and the target NOI
- All revenue line items are summed, all expense line items are summed, and the implied NOI
  (Revenue − Expenses) is computed per month and in total
- A reconciliation row at the bottom shows the discrepancy between implied NOI and the designated
  NOI row, as a dollar amount per month column and total column
- Discrepancy updates in real time as the user maps `UNMAPPED` items or reclassifies existing ones
- Non-zero discrepancy is highlighted in red; user cannot save until discrepancy is $0 or
  explicitly overrides with a confirmation prompt
- User can save the reconciliation at any point; saved state includes the designated expense/NOI
  boundary, all category mappings, and the reconciled data — stored in `reports` table with
  `processedData` and `mappingState`
- User can return to the reconciliation view at any time to adjust mappings or reclassify line
  items; changes trigger a re-reconciliation and must resolve to $0 discrepancy (or explicit
  override) before re-saving

**Final T12 View**

Once reconciliation is saved, the T12 renders as a formatted financial table:

- Rows are grouped by mapped category (e.g., *Payroll*, *Utilities*, *Repair & Maintenance*),
  showing the aggregated total across all original line items within that category
- Each mapped category row is expandable via a disclosure triangle or chevron, revealing the
  original line items mapped to it in indented sub-rows:
    Repair & Maintenance        $X    $X    $X    ...
        Maintenance & Repairs Payroll   $X    $X    $X
        Maintenance & Repairs Supply    $X    $X    $X
        Maintenance & Repairs Contract  $X    $X    $X
- Expanded sub-rows are UI-only and do not appear in the downloaded Excel file; the download
  contains only the mapped category aggregates
- Per-unit and % EGI columns are computed at the mapped category level, not the original line
  item level
- User can download as Excel


**Schema output:** `T12Data` (see `lib/schemas.ts`)

### 3. Rent Roll Processing

**Routes:** `/rent-roll`, `/api/rediq/process-rentroll`

- Accepts Excel files only (`.xlsx`, `.xls` — PDF not accepted)
- Auto-detects format: Yardi multi-row Excel → `yardi-parser.ts`, generic Excel → Claude extraction
- Yardi parser: deterministic, no AI, handles charge codes (rent/park/pet/stor/conc/hap)
- Generic parser: Claude-assisted field mapping → `RentRollData`
- UI renders unit table with occupancy, market/actual rent, loss-to-lease, lease dates
- Can save to property + download Excel

**Schema outputs:** `RentRollData` (generic), `ParsedRentRoll` (Yardi-specific)

### 4. CoStar Rent Comps

**Routes:** `/rent-comps`, `/api/rentcomps/process`

- User uploads CoStar Underwriting Report PDF
- Client-side PDF.js extracts pages → `costar-parser-regex.ts` parses summary table + unit mix
- Three output tabs: Summary Table, Unit Mix Detail, Subject vs. Comps comparison
- Can save to property + download Excel

**Schema output:** `RentCompsData` (see `lib/schemas.ts`)

### 5. Trade-Out Analysis

**Route:** `/trade-out`

- User uploads 2+ Yardi rent rolls from different time periods
- Parser compares unit-by-unit rent changes
- Outputs: per-unit trade-out table, floor plan summary with avg rent by period
- Useful for measuring rent growth between renewals/new leases

### 6. Combined RedIQ Flow

**Route:** `/rediq`

- Legacy combined upload: T12 + rent roll together in one flow
- Useful for quick side-by-side processing
- May be merged into the property detail flow in a future phase

---

## Planned Modules (not yet built — DO NOT build without explicit instruction)

- **Proforma / valuation modeling** — QuickVal, full 10-year DCF
- **Deal pipeline** — kanban by deal stage
- **Anomaly detection** — automated flags on rent roll / T12 data
- **Internal comp generation** — query historical reports as comp set
- **Arel-branded PDF reports** — currently only Excel output exists
- **Full Excel export with multiple tabs** — currently single-tab outputs

---

## Key Constraints (DO NOT CHANGE without discussion)

- **App Router only** — no Pages Router
- **getDb() inside handlers only** — never at module scope
- **callClaude() wrapper always** — never raw Anthropic client in routes
- **Clerk auth on every API route** — userId check before any DB access
- **processedData stored as jsonb** — full parsed output saved to DB for inline preview
- **File type enforcement** — T12 and Rent Roll accept `.xlsx` / `.xls` only; reject PDF with a clear error message. Rent Comps accepts `.pdf` only
- **T12 parsing is regex-first** — `lib/t12-parser.ts` runs deterministically; Claude called only as fallback if regex returns <3 line items
- **Rent roll parsing is server-side** — xlsx extraction runs on server, Claude called from API route for generic formats