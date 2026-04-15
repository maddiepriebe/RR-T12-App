const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const DEFAULT_ALLOWED_EXT = ["xlsx", "xls", "csv", "pdf", "txt"] as const;

const DEFAULT_ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/octet-stream", // browsers sometimes send this for csv/xls
] as const;

export interface UploadGuardOptions {
  maxBytes?: number;
  allowedExt?: readonly string[];
  allowedMime?: readonly string[];
}

export interface UploadGuardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function validateUpload(
  file: File,
  opts: UploadGuardOptions = {}
): UploadGuardResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedExt = opts.allowedExt ?? DEFAULT_ALLOWED_EXT;
  const allowedMime = opts.allowedMime ?? DEFAULT_ALLOWED_MIME;

  if (file.size === 0) {
    return { ok: false, status: 400, error: "File is empty" };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `File exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
    };
  }

  const name = file.name || "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!allowedExt.includes(ext)) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported file extension: .${ext || "(none)"}`,
    };
  }

  // MIME may be absent on some clients; enforce only when present.
  if (file.type && !allowedMime.includes(file.type)) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported content type: ${file.type}`,
    };
  }

  return { ok: true };
}
