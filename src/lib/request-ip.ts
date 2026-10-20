import "server-only";
import { headers } from "next/headers";
import { normalizeIp } from "./ip";

/**
 * The client's public IP as seen by the platform.
 *
 * On Vercel, `x-real-ip` and `x-forwarded-for` are set by Vercel's edge and cannot be spoofed
 * by the client. If this app is ever hosted elsewhere, make sure the proxy in front of it
 * overwrites these headers, or the building-network check can be bypassed.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const candidate = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  return candidate ? normalizeIp(candidate) : null;
}
