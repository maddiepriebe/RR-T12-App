# Backend Architecture — RR-T12-App

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Drizzle ORM (`drizzle-orm/neon-http`) |
| File Storage | Vercel Blob (`@vercel/blob`) |
| Auth | Clerk (`@clerk/nextjs`) |
| AI / Parsing | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| PDF (server) | `pdf-parse` |
| PDF (client) | PDF.js (`extract-pdf-client.ts`) |
| Excel | `xlsx` |

---

## Database Schema (current — `lib/db/schema.ts`)

### `operators`
```ts
{
  id: uuid PK
  name: text
  clerkOrgId: text nullable
  clerkUserId: text nullable
  createdAt: timestamp
}
```
Note: `operators` is provisioned but not actively used in current flows. Properties are scoped to `clerkUserId` on the `properties` table directly.

### `properties`
```ts
{
  id: uuid PK
  operatorId: uuid nullable FK → operators.id
  clerkUserId: text NOT NULL        -- Clerk user ID (auth scope)
  name: text NOT NULL
  address: text nullable
  city: text nullable
  state: text nullable              -- 2-char state code
  zip: text nullable
  units: integer nullable
  createdAt: timestamp
}
```

### `reports`
```ts
{
  id: uuid PK
  propertyId: uuid nullable FK → properties.id
  type: text NOT NULL              -- "t12" | "rentroll" | "rentcomps" | "tradeout"
  label: text nullable             -- user-defined label (e.g., "T12 Mar 2024")
  excelUrl: text nullable          -- Vercel Blob URL for Excel download
  metadata: jsonb nullable         -- lightweight metadata (period, unit count, etc.)
  processedData: jsonb nullable    -- full parsed output for inline preview
  createdAt: timestamp
}
```

### `t12Mappings`
```ts
{
  id: uuid PK
  operatorId: uuid nullable FK → operators.id
  rawLabel: text NOT NULL          -- original line item label from document
  mappedCategory: text NOT NULL    -- standardized COA category
  createdAt: timestamp
}
```
Note: `t12Mappings` supports future COA learning/persistence. Not actively queried in current flows.

---

## TypeScript Interfaces (current — `lib/schemas.ts`)

### T12

```ts
interface T12LineItem {
  category: "income" | "expense" | "noi"
  label: string
  actual: number | null
  perUnit: number | null
  pctEGI: number | null
  isSubtotal?: boolean
  isTotal?: boolean
  indent?: number
}

interface T12Data {
  propertyName?: string
  period?: string
  unitCount?: number
  lineItems: T12LineItem[]
}
```

### Rent Roll (Generic)

```ts
interface RentRollUnit {
  unit: string | null
  unitType: string | null
  bed: number | null
  bath: number | null
  sqFt: number | null
  tenantName: string | null
  leaseStart: string | null       // YYYY-MM-DD
  leaseEnd: string | null
  marketRent: number | null
  actualRent: number | null
  lossToLease: number | null
  status: "Occupied" | "Vacant" | "Notice" | null
  moveInDate: string | null
  notes: string | null
}

interface RentRollData {
  propertyName?: string
  date?: string
  units: RentRollUnit[]
}
```

### Rent Comps (CoStar)

```ts
interface CompSummary {
  rank: number
  isSubject?: boolean
  name: string
  address: string
  city: string
  state: string
  yearBuilt: number | null
  totalUnits: number | null
  stories: number | null
  avgUnitSF: number | null
  distanceToSubjectMiles: number | null
  coStarRating: number | null
  studioAskingRent: number | null
  oneBedAskingRent: number | null
  twoBedAskingRent: number | null
  threeBedAskingRent: number | null
  rentPerSF: number | null
  totalVacancyPct: number | null
  totalAvailabilityPct: number | null
  askingRentPerUnit: number | null
  askingRentPerSF: number | null
  effectiveRentPerUnit: number | null
  effectiveRentPerSF: number | null
  concessionsPct: number | null
  owner?: string | null
  propertyManager?: string | null
}

interface UnitTypeDetail {
  bed: number
  bath: number | null
  avgSF: number | null
  units: number | null
  mixPct: number | null
  availableUnits: number | null
  availabilityPct: number | null
  askingRentPerUnit: number | null
  askingRentPerSF: number | null
  effectiveRentPerUnit: number | null
  effectiveRentPerSF: number | null
  concessionsPct: number | null
  label?: string
}

interface CompDetail {
  propertyName: string
  isSubject?: boolean
  unitTypes: UnitTypeDetail[]
  amenities?: Record<string, string>
  parking?: string | null
  petPolicy?: string | null
  yearBuilt?: number | null
  address?: string
}

interface RentCompsData {
  subjectProperty: CompDetail | null
  comps: CompSummary[]
  compDetails: CompDetail[]
  reportDate?: string
}
```

---

## API Routes

### Properties

```
GET  /api/properties                      list all properties for current user
POST /api/properties                      create property
GET  /api/properties/[id]                 get single property
PATCH /api/properties/[id]               update property
DELETE /api/properties/[id]              delete property

GET  /api/properties/[id]/reports         list all reports for property
POST /api/properties/[id]/reports         save a report (type, label, excelUrl, processedData)
GET  /api/properties/[id]/reports/[rid]   get single report
DELETE /api/properties/[id]/reports/[rid] delete report
```

### T12 Processing

```
POST /api/rediq/process-t12
  body: FormData { file: File }
  response: { success: true, data: T12Data, usedAI: boolean, warning?: string }
            | { success: false, error: string }
  
  Pipeline:
    1. Extract text: parsePDF(file) for PDF, xlsx for Excel
    2. parseT12WithRegex(text) → { data: T12Data, confidence: "high" | "low" }
    3. If confidence === "high" (≥3 line items): return { success: true, data, usedAI: false }
    4. If confidence === "low": callClaude(T12_SYSTEM_PROMPT, text) → T12Data fallback
    5. Return { success: true, data, usedAI: true }
```

### Rent Roll Processing

```
POST /api/rediq/process-rentroll
  body: FormData { file: File }
  response: { success: true, format: "yardi" | "generic", data: ParsedRentRoll | RentRollData }
            | { success: false, error: string }
  
  Pipeline:
    1. Detect file type (Excel → try Yardi detection, PDF → generic)
    2. Yardi Excel: parseYardiRentRoll(buffer) → ParsedRentRoll (deterministic, no AI)
    3. Generic: parsePDF(file) → callClaude(RENT_ROLL_PROMPT, text) → RentRollData
```

### Excel Downloads

```
POST /api/rediq/download
  body: { data: T12Data | RentRollData, type: "t12" | "rentroll", propertyName?: string }
  response: { url: string }  ← Vercel Blob URL

POST /api/rentcomps/download
  body: { data: RentCompsData, propertyName?: string }
  response: { url: string }
```

### CoStar Comps

```
POST /api/rentcomps/process        (optional server-side path — primary parsing is client-side)
POST /api/costar-parse             alternative CoStar parse endpoint
```

---

## Parsing Architecture

### CoStar PDF (Client-Side)

```
User selects PDF
→ extractPDFPages(file)            lib/extract-pdf-client.ts — PDF.js in browser
  → pages: string[]                one string per page, space-joined from PDF.js y-groups
→ parseCoStarPages(pages)          lib/costar-parser.ts entry point
  → costar-parser-regex.ts         pure regex parser
    → parseComparablesSummary()    extracts CompSummary[]
    → parseUnitMixSection()        extracts CompDetail[] with UnitTypeDetail[]
  → RentCompsData
→ render in UI tabs
→ on save: POST /api/properties/[id]/reports with processedData = RentCompsData
```

**CoStar parser notes:**
- The parser is tuned to the exact multi-line format PDF.js produces
- Property names, ranks, addresses, and data lines appear on separate lines (not one line per comp)
- Key anchor: `"No. Rent Comps"` identifies the summary table section
- Rank numbers appear as standalone lines (`"1"`, `"2"`, etc.)
- `looksLikeName()` and `isStreetAddress()` distinguish name lines from address lines
- Do not restructure this parser — make targeted fixes only

### T12 PDF (Server-Side, Regex-First)

```
POST /api/rediq/process-t12
→ extract text:
    PDF  → parsePDF(file)         lib/pdf-parser.ts
    Excel → xlsx sheet_to_csv
→ parseT12WithRegex(text)         lib/t12-parser.ts — pure function, no API calls
    → identify income section by keywords: "income", "revenue", "gross potential", "GPR"
    → identify expense section by keywords: "expense", "operating", "payroll",
      "maintenance", "insurance", "taxes", "management"
    → identify NOI by keywords: "net operating income", "NOI"
    → extract label + dollar amount pairs via regex
    → map to T12LineItem categories (income / expense / noi)
    → return { data: T12Data, confidence: "high" | "low" }
        confidence "high" = ≥3 line items found
        confidence "low"  = <3 line items found
→ if confidence === "high": return { success: true, data, usedAI: false }
→ if confidence === "low":
    → callClaude(T12_SYSTEM_PROMPT, text)   lib/anthropic.ts
    → parseClaudeJSON<T12Data>()
    → return { success: true, data, usedAI: true }
```

**lib/t12-parser.ts** is a pure function — text in, structured data out. No DB calls, no API calls, no side effects. Easy to unit test independently.

### Yardi Rent Roll Excel (Server-Side, Deterministic)

```
POST /api/rediq/process-rentroll
→ detect Yardi format (column headers: "Unit", "Plan", charge code row)
→ parseYardiRentRoll(buffer)       lib/yardi-parser.ts
  → section detection (by unit groupings)
  → charge code mapping (CHARGE_CODE_SLOTS)
  → ParsedRentRoll { units: ParsedUnit[], summary stats }
→ return { format: "yardi", data }
```

### Generic Rent Roll (Server-Side, AI-Assisted)

```
POST /api/rediq/process-rentroll
→ parsePDF(file) or read Excel as text
→ callClaude(RENT_ROLL_PROMPT, text)
  → JSON string with RentRollData structure
→ parseClaudeJSON<RentRollData>()
→ return { format: "generic", data }
```

---

## Auth Pattern (every API route)

```ts
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const db = getDb();
  // ... all authenticated users share the same data — do NOT filter by userId
}
```

`userId` is used for authentication only — to confirm the request comes from a logged-in user. It is never used to filter or scope database queries. All properties and reports are shared across all authenticated users.

---

## Error Handling Pattern

```ts
try {
  // handler logic
  return NextResponse.json({ success: true, data: result });
} catch (err) {
  console.error("Route error:", err);
  return NextResponse.json(
    { success: false, error: err instanceof Error ? err.message : "Internal server error" },
    { status: 500 }
  );
}
```

---

## Environment Variables

```
DATABASE_URL            Neon PostgreSQL connection string
ANTHROPIC_API_KEY       Claude API key
BLOB_READ_WRITE_TOKEN   Vercel Blob token
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

`lib/anthropic.ts` reads `ANTHROPIC_API_KEY` directly.
`lib/db/index.ts` reads `DATABASE_URL` inside `getDb()` (lazy, not at module scope).