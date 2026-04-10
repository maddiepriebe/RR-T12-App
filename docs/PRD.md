# Product Requirements Document — RR-T12-App

## Overview

RR-T12-App (`arel-underwriting`) is an internal multifamily real estate underwriting platform for **Arel Capital**. It replicates and extends RedIQ's core functionality — replacing manual document processing with an automated, AI-assisted pipeline from raw deal documents to completed underwriting output, all inside a single web interface.

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, PostgreSQL (Neon), Drizzle ORM, Vercel Blob, Clerk (auth), Anthropic Claude API, PDF.js, xlsx

---

## Goals

1. Ingest raw deal documents (T12 Excel, rent roll Excel, CoStar PDFs) and extract structured data automatically
2. Standardize all parsed data into a consistent internal schema
3. Allow analysts to review, edit, and save parsed results per property
4. Generate downloadable Excel outputs in Arel Capital format
5. Maintain a searchable property library with attached reports

## Non-Goals (v1)

- Public-facing access / multi-tenant SaaS
- Mobile-native app
- Full proforma / DCF modeling (future phase)
- Deal pipeline kanban (future phase)
- Internal comp generation from historical deals (future phase)

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
- UI renders the T12 in a financial table with per-unit and % EGI columns
- If Claude fallback was used, an amber banner displays: "AI extraction was used — verify line items"
- User can save the result to a property → stored in `reports` table with `processedData`
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