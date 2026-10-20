import "server-only";
import { signedUrl, type MediaSize } from "./cloudinary";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSize(request: Request): MediaSize {
  return new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
}

/**
 * Fetch a private Cloudinary asset server-side and stream it to the (already authorised) admin.
 * The signed Cloudinary URL never reaches the browser.
 */
export async function proxyMedia(publicId: string, size: MediaSize, isPdf = false): Promise<Response> {
  const upstream = await fetch(signedUrl(publicId, { size, isPdf }), { cache: "no-store" });
  const type = upstream.headers.get("content-type")?.split(";")[0] ?? "";
  if (!upstream.ok || !upstream.body || !ALLOWED_TYPES.has(type)) {
    return new Response("File unavailable", { status: upstream.status === 404 ? 404 : 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
