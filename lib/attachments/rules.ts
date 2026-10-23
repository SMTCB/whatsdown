export const ATTACH_LIMITS = { maxFiles: 3, maxBytes: 5 * 1024 * 1024 } as const;

export type AttachmentKind = "pdf" | "png" | "jpeg" | "text" | "docx";

export const KIND_INFO: Record<AttachmentKind, { mime: string; exts: string[]; label: string }> = {
  pdf: { mime: "application/pdf", exts: ["pdf"], label: "PDF" },
  png: { mime: "image/png", exts: ["png"], label: "PNG image" },
  jpeg: { mime: "image/jpeg", exts: ["jpg", "jpeg"], label: "JPEG image" },
  text: { mime: "text/plain", exts: ["txt", "md", "log", "csv"], label: "text file" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", exts: ["docx"], label: "Word document" },
};

/** Value for the file input's `accept` attribute. */
export const ACCEPT = Object.values(KIND_INFO)
  .flatMap((k) => k.exts.map((e) => `.${e}`))
  .join(",");

export interface UploadCandidate {
  name: string;
  bytes: Uint8Array;
}

export interface AcceptedUpload {
  name: string;
  kind: AttachmentKind;
  mime: string;
  bytes: Uint8Array;
}

export interface UploadCheck {
  accepted: AcceptedUpload[];
  errors: string[];
}

/** Strips any path, control characters and odd symbols; keeps the extension. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").trim();
  return (cleaned || "file").slice(0, 100);
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

function looksLikeText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Decides the kind from the extension, then confirms the content matches it (the browser's MIME type is not trusted). */
function detectKind(name: string, bytes: Uint8Array): AttachmentKind | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind = (Object.keys(KIND_INFO) as AttachmentKind[]).find((k) => KIND_INFO[k].exts.includes(ext));
  if (!kind) return null;
  const ok =
    (kind === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) ||
    (kind === "png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (kind === "jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    (kind === "docx" && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) ||
    (kind === "text" && looksLikeText(bytes));
  return ok ? kind : null;
}

export function validateUploads(files: readonly UploadCandidate[]): UploadCheck {
  const accepted: AcceptedUpload[] = [];
  const errors: string[] = [];
  const real = files.filter((f) => f.bytes.length > 0 || f.name !== "");
  if (real.length > ATTACH_LIMITS.maxFiles) {
    errors.push(`You can attach up to ${ATTACH_LIMITS.maxFiles} files.`);
    return { accepted, errors };
  }
  for (const f of real) {
    const name = sanitizeFilename(f.name);
    if (f.bytes.length === 0) errors.push(`${name} is empty.`);
    else if (f.bytes.length > ATTACH_LIMITS.maxBytes) errors.push(`${name} is larger than ${ATTACH_LIMITS.maxBytes / 1024 / 1024} MB.`);
    else {
      const kind = detectKind(name, f.bytes);
      if (!kind) errors.push(`${name} is not a supported file. Use PDF, PNG, JPEG, Word (.docx) or text.`);
      else accepted.push({ name, kind, mime: KIND_INFO[kind].mime, bytes: f.bytes });
    }
  }
  return { accepted, errors };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
