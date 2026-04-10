# CLAUDE.md — RR-T12-App

This file is read automatically by Claude Code at the start of every session. Read it fully before writing any code.

## What This App Is

RR-T12-App (`arel-underwriting`) is an internal multifamily real estate underwriting platform for **Arel Capital**. It automates the pipeline from raw deal documents (rent rolls, T12 operating statements, CoStar PDFs) to a completed underwriting output.

**Full details in:**
- `docs/PRD.md` — what we're building and why
- `docs/APP_FLOW.md` — every user flow and route, screen by screen
- `docs/DESIGN.md` — visual design system and component patterns
- `docs/BACKEND.md` — database schema, API routes, parsing architecture

Read the relevant doc before implementing any feature. Do not guess at intended behavior.

---

## Stack (non-negotiable)

- **Next.js 14 App Router** — no Pages Router patterns
- **TypeScript** — no `any` without an explicit justification comment
- **Drizzle ORM** via `getDb()` from `@/lib/db` — no raw SQL, no Prisma
- **Vercel Blob** (`@vercel/blob`) — all file storage, never local filesystem
- **Anthropic Claude API** via `callClaude()` / `parseClaudeJSON()` in `@/lib/anthropic` — always `claude-sonnet-4-20250514`, never OpenAI
- **Clerk** for auth — already configured, do not touch
- **Tailwind CSS** — use existing utility classes and CSS vars from `globals.css`
- **Zod** — validate every API route input

---

## Existing File Structure

```
app/
  page.tsx                          → redirects to /properties
  layout.tsx                        → ClerkProvider, global font
  globals.css                       → CSS vars (navy/gold), utility classes
  properties/
    page.tsx                        → deal/property list + create modal
    [id]/page.tsx                   → property detail + saved reports
  rent-comps/page.tsx               → CoStar PDF upload + comps viewer
  rent-roll/page.tsx                → rent roll upload + preview
  t12/page.tsx                      → T12 upload + preview
  trade-out/page.tsx                → multi-period Yardi rent roll comparison
  rediq/page.tsx                    → combined T12 + rent roll upload (combined flow)
  sign-in/, sign-up/                → Clerk auth pages
  api/
    properties/route.ts             → GET/POST properties
    properties/[id]/route.ts        → GET/PATCH/DELETE property
    properties/[id]/reports/route.ts
    properties/[id]/reports/[reportId]/route.ts
    rediq/process-t12/route.ts      → T12 Excel only (.xlsx/.xls) → regex parser → Claude fallback → T12Data
    rediq/process-rentroll/route.ts → rent roll Excel only (.xlsx/.xls) → parsed data
    rediq/download/route.ts         → generate Excel download
    rentcomps/process/route.ts      → CoStar PDF processing
    rentcomps/download/route.ts     → comps Excel download
    costar-parse/route.ts           → CoStar parser endpoint

lib/
  anthropic.ts            → callClaude(), parseClaudeJSON(), MODEL constant
  schemas.ts              → TypeScript interfaces: T12Data, RentRollData, RentCompsData, etc.
  db/
    index.ts              → getDb() lazy initializer (call inside handlers only)
    schema.ts             → Drizzle tables: operators, properties, reports, t12Mappings
  costar-parser.ts        → CoStar PDF parser entry point
  costar-parser-regex.ts  → Pure regex CoStar PDF parser (primary, carefully tuned)
  t12-parser.ts           → Regex-first T12 parser (pure function — no API calls inside)
  yardi-parser.ts         → Yardi "Rent Roll with Lease Charges" deterministic parser
  extract-pdf-client.ts   → Client-side PDF extraction (PDF.js) — Rent Comps only
  excel-builder.ts        → Excel output generation (xlsx)
  rediq-builder.ts        → RedIQ-style Excel output builder
  canvas-stub.js          → Canvas shim for PDF.js in non-browser env

components/
  shared/
    NavBar.tsx            → Top nav (Arel branding, navy/gold)
    ProgressIndicator.tsx → Step progress UI
  rediq/
    UploadZone.tsx        → Drag-and-drop file upload
    T12Preview.tsx        → T12 data table
    RentRollPreview.tsx   → Generic rent roll table
    YardiRentRollPreview.tsx → Yardi-specific rent roll display
  rentcomps/
    CoStarUpload.tsx      → CoStar PDF upload
    CompsSummaryTable.tsx → Comps summary table
    UnitMixDetail.tsx     → Per-unit-type breakdown
    SubjectVsComps.tsx    → Subject vs comps comparison
  properties/
    ReportPreview.tsx     → Saved report preview

scripts/
  test-costar-parser.mjs  → Local test runner for CoStar parser
```

---

## Design System (quick ref — full details in docs/DESIGN.md)

**CSS Variables (globals.css):**
```
--navy-950: #061629   --navy-900: #0a2240   --navy-800: #10304d   --navy-700: #1a3f5f
--gold-500: #eebb38   --gold-400: #f1c757
```

**Existing utility classes — use these, don't reinvent:**
- `.finance-table` — standard financial data table with header/subtotal/total row styles
- `.upload-zone` — drag-and-drop zone with drag-active and has-file states
- `.btn-primary`, `.btn-gold`, `.btn-outline` — button variants
- `.card` — white rounded card with shadow
- `.section-header` — small-caps uppercase label

---

## Database (current schema)

```
operators   → id, name, clerkOrgId, clerkUserId, createdAt
properties  → id, operatorId, clerkUserId, name, address, city, state, zip, units, createdAt
reports     → id, propertyId, type, label, excelUrl, metadata, processedData, createdAt
t12Mappings → id, operatorId, rawLabel, mappedCategory, createdAt
```

`reports.type`: `"t12" | "rentroll" | "rentcomps" | "tradeout"`
`reports.processedData`: full parsed JSON blob for inline preview (jsonb)

---

## Hard Rules

1. **Auth is Clerk, not data scoping.** Every API route: `const { userId } = await auth()`, return 401 if null. Auth confirms the request comes from a logged-in user — do NOT use `userId` to filter database queries. All authenticated users share the full property library.

2. **DB via getDb().** Import `getDb` from `@/lib/db`. Call it inside the request handler, never at module scope.

3. **Claude API via callClaude().** Use the wrapper in `@/lib/anthropic.ts`. Don't instantiate Anthropic directly in route handlers.

4. **Schemas live in lib/schemas.ts.** All shared TypeScript interfaces go there. Don't create duplicate type definitions in components.

5. **No placeholder UI.** Don't implement features with hardcoded data and a TODO. Either implement properly or tell me what's missing.

6. **Don't touch auth or middleware.** `middleware.ts` and `app/layout.tsx` are stable. Do not modify.

7. **Don't run schema migrations without asking.** If a change to `lib/db/schema.ts` is needed, stop and describe the change before touching it.

8. **Don't add npm packages without asking.** Name the package and reason first.

9. **CoStar parser is fragile.** `costar-parser-regex.ts` has been carefully tuned to the exact PDF.js output format. Do not restructure it. Describe any bug fix before making it.

11. **File type enforcement.** T12 and Rent Roll routes reject anything that isn't `.xlsx` or `.xls` — return a 400 with a clear error message before doing any processing. Rent Comps accepts `.pdf` only. Never silently ignore a wrong file type or try to parse it anyway.

---

## When You're Unsure

- **Intended behavior** → `docs/APP_FLOW.md`
- **Data shape** → `docs/BACKEND.md` + `lib/schemas.ts`
- **UI/layout** → `docs/DESIGN.md` + look at existing page components
- **Scope** → `docs/PRD.md`

If still unclear: **ask before implementing.**