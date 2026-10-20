import "server-only";

export type FileKind = "jpeg" | "png" | "webp" | "pdf";

/** Detect the real file type from its first bytes. The browser-sent MIME type is not trusted. */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  return null;
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_SELFIE_BYTES = 1.5 * 1024 * 1024;

export type ReadFileResult = { ok: true; buffer: Buffer; kind: FileKind } | { ok: false; error: string } | null;

/**
 * Read an uploaded File from FormData and check its size and type.
 * Returns null when no file was chosen.
 */
export async function readUpload(
  value: FormDataEntryValue | null,
  allowed: FileKind[],
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<ReadFileResult> {
  if (!value || typeof value === "string" || value.size === 0) return null;
  if (value.size > maxBytes) {
    return { ok: false, error: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).` };
  }
  const buffer = Buffer.from(await value.arrayBuffer());
  const kind = sniffFileKind(buffer);
  if (!kind || !allowed.includes(kind)) {
    return { ok: false, error: `Unsupported file type. Allowed: ${allowed.join(", ").toUpperCase()}.` };
  }
  return { ok: true, buffer, kind };
}
