import { connection } from "next/server";
import { getLogoId } from "@/lib/branding";
import { logoSignedUrl } from "@/lib/cloudinary";

/**
 * Public: the institution logo, needed on the login screens. Only this one asset is exposed;
 * student photos, ID cards and selfies stay behind /api/media (admin only). The URL carries a
 * version (?v=updatedAt), so the response can be cached long-term.
 */
export async function GET() {
  await connection();
  const logoId = await getLogoId();
  if (!logoId) return new Response("No logo", { status: 404 });

  const upstream = await fetch(logoSignedUrl(logoId), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!upstream.ok || !upstream.body || upstream.headers.get("content-type")?.split(";")[0] !== "image/png") {
    return new Response("Logo unavailable", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Disposition": "inline",
    },
  });
}
