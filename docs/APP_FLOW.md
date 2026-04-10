# App Flow — RR-T12-App

## Route Map

```
/                             → redirect to /properties
/properties                   → Property list + create new property
/properties/[id]              → Property detail (saved reports, previews, downloads)
/t12                          → T12 upload + parse + preview + save
/rent-roll                    → Rent roll upload + parse + preview + save
/rent-comps                   → CoStar PDF upload + comp viewer (3 tabs) + save
/trade-out                    → Multi-period Yardi rent roll comparison
/rediq                        → Combined T12 + rent roll upload (single flow)
/sign-in, /sign-up            → Clerk auth (public routes)
```

---

## Flow 1: Properties List

Page: `/properties`

**Layout:** Sidebar (state grouping) + main content (property cards)

- On load: `GET /api/properties` → renders property cards grouped by state
- State sidebar: clicking a state filters the card grid
- **New Property** button → modal with form: name (required), address, city, state, zip, units
- On submit: `POST /api/properties` → refresh list
- Each property card links to `/properties/[id]`

---

## Flow 2: Property Detail

Page: `/properties/[id]`

- On load: `GET /api/properties/[id]` + `GET /api/properties/[id]/reports`
- Shows property header: name, address, unit count
- Lists all saved reports grouped by type (T12, Rent Roll, Rent Comps, Trade-Out)
- Each report row: label, date, type badge, download link (excelUrl), preview button
- **Preview:** `ReportPreview` component renders the stored `processedData` inline
- **Quick links** to upload flows: "Upload T12", "Upload Rent Roll", "Add Comps" (pre-select property)

---

## Flow 3: T12 Processing

Page: `/t12`

**Step 1 — Upload**
- `UploadZone` accepts `.pdf`, `.xlsx`, `.xls` (single file)
- Optional: select a property from dropdown to auto-save after processing
- Click "Process" → starts processing flow

**Step 2 — Processing (3 steps shown via ProgressIndicator)**
1. "Extracting document text" — `POST /api/rediq/process-t12` with FormData
2. "Mapping fields with AI" — server calls `parsePDF()` then `callClaude()` with T12 system prompt
3. "Building output" — Claude returns `T12Data` JSON

**Step 3 — Preview**
- `T12Preview` renders line items in `.finance-table`
- Income section → Expense section → NOI row
- Each row: label, actual ($), per unit ($/unit), % EGI
- Subtotal rows (EGI, Total Expenses, NOI) highlighted with `.row-subtotal` / `.row-total`

**Step 4 — Save / Download**
- "Save to Library" → `POST /api/properties/[id]/reports` with `{ type: "t12", processedData, label }`
- "Download Excel" → `POST /api/rediq/download` → returns blob URL → triggers download

---

## Flow 4: Rent Roll Processing

Page: `/rent-roll`

**Step 1 — Upload**
- `UploadZone` accepts `.pdf`, `.xlsx`, `.xls`
- Optional property selection

**Step 2 — Processing**
- `POST /api/rediq/process-rentroll` with FormData
- Server detects format:
  - **Yardi Excel** → `yardi-parser.ts` deterministic parse → returns `{ format: "yardi", data: ParsedRentRoll }`
  - **Generic** → `parsePDF()` + `callClaude()` → returns `{ format: "generic", data: RentRollData }`

**Step 3 — Preview**
- **Yardi format** → `YardiRentRollPreview` — shows units with charge code breakdown (rent, park, pet, stor, conc, HAP)
- **Generic format** → `RentRollPreview` — shows unit table: unit#, type, bed/bath, sqft, tenant, lease dates, market rent, actual rent, loss-to-lease, status

**Step 4 — Save / Download**
- Same pattern as T12: save to library or download Excel

---

## Flow 5: CoStar Rent Comps

Page: `/rent-comps`

**Step 1 — Upload**
- `CoStarUpload` component — accepts CoStar Underwriting Report PDF only
- Subject property name input (optional — helps anchor parsing)
- Optional property selection for saving

**Step 2 — Client-Side Processing (runs in browser)**
1. "Reading PDF in browser" — `extractPDFPages()` via PDF.js
2. "Parsing summary table" — `parseCoStarPages()` from `costar-parser.ts` / `costar-parser-regex.ts`
3. "Extracting unit mix details" — same parser, unit mix section

**Important:** CoStar parsing is entirely client-side. The PDF never leaves the browser during parsing. The parsed `RentCompsData` is what gets saved to the server.

**Step 3 — Three-Tab Results**
- **Summary tab:** `CompsSummaryTable` — ranked comp table: name, address, units, yr built, stories, avg SF, distance, CoStar rating, asking/effective rents, vacancy, concessions
- **Unit Mix tab:** `UnitMixDetail` — per-comp unit type breakdown (studio/1BR/2BR/3BR): units, avg SF, availability, asking rent/SF, effective rent/SF, concessions
- **Comparison tab:** `SubjectVsComps` — subject property vs. each comp, side by side

**Step 4 — Save / Download**
- Save to library → `POST /api/properties/[id]/reports` with `{ type: "rentcomps", processedData }`
- Download Excel → `POST /api/rentcomps/download`

---

## Flow 6: Trade-Out Analysis

Page: `/trade-out`

**Step 1 — Upload Multiple Periods**
- Default: 2 periods (can add more)
- Each period: file upload (Yardi Excel) + label (e.g., "Q1 2024", "Q3 2024")
- Click "Analyze Trade-Out"

**Step 2 — Processing**
- Each file sent to `/api/rediq/process-rentroll` → Yardi parser
- Client computes unit-by-unit rent changes across periods

**Step 3 — Results**
- **Unit table:** unit ID, floor plan, sq ft, rent per period, trade-out $ and %
- **Floor plan summary:** avg rent per period + avg trade-out by plan type
- Positive trade-out = green, negative = red

---

## Flow 7: Combined RedIQ Flow

Page: `/rediq`

Single flow to upload both T12 and rent roll at the same time.

- Two upload zones: T12 file + Rent Roll file (either or both)
- Parallel processing: both files sent simultaneously
- Results shown side by side once complete: T12Preview + RentRollPreview (or YardiRentRollPreview)
- Download combined Excel

---

## Global UI Patterns

- **ProgressIndicator:** shown during all async processing — steps are: pending → active → done | error
- **Error states:** displayed inline below the process button with the error message
- **Save flow:** "Save to Library" only appears after successful processing; requires property selection
- **Property dropdown:** populated on mount via `GET /api/properties`; pre-selects if `?propertyId=` is in URL
- **NavBar:** always present; active link highlighted in gold; Arel logo links to /properties; Clerk UserButton in top right