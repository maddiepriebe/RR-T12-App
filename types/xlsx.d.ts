declare module "xlsx" {
  interface WorkBook {
    SheetNames: string[];
    Sheets: { [name: string]: WorkSheet };
  }

  interface WorkSheet {
    [cell: string]: unknown;
  }

  interface ParsingOptions {
    type?: "buffer" | "array" | "string" | "base64" | "binary" | "file";
    [key: string]: unknown;
  }

  interface Sheet2JSONOpts {
    header?: number | 1;
    defval?: unknown;
    [key: string]: unknown;
  }

  interface JSON2SheetOpts {
    header?: string[];
    skipHeader?: boolean;
    [key: string]: unknown;
  }

  interface WritingOptions {
    type?: "buffer" | "array" | "string" | "base64" | "binary" | "file";
    bookType?: string;
    [key: string]: unknown;
  }

  interface AOA2SheetOpts {
    [key: string]: unknown;
  }

  function read(data: unknown, opts?: ParsingOptions): WorkBook;
  function write(wb: WorkBook, opts?: WritingOptions): unknown;
  function readFile(filename: string, opts?: ParsingOptions): WorkBook;
  function writeFile(wb: WorkBook, filename: string, opts?: WritingOptions): void;

  const utils: {
    sheet_to_json<T = unknown>(worksheet: WorkSheet, opts?: Sheet2JSONOpts): T[];
    json_to_sheet(data: unknown[], opts?: JSON2SheetOpts): WorkSheet;
    aoa_to_sheet(data: unknown[][], opts?: AOA2SheetOpts): WorkSheet;
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void;
    decode_range(range: string): { s: { c: number; r: number }; e: { c: number; r: number } };
    encode_cell(cell: { c: number; r: number }): string;
    encode_range(range: { s: { c: number; r: number }; e: { c: number; r: number } }): string;
    sheet_add_aoa(ws: WorkSheet, data: unknown[][], opts?: { origin?: string | number }): WorkSheet;
  };
}
