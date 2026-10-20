import "server-only";
import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { darken, DEFAULT_PRIMARY } from "./color";

export const BRANDING_TAG = "branding";
export const DEFAULT_ORG_NAME = "Hostel Attendance";

export type Branding = {
  orgName: string;
  primaryColor: string;
  primaryHover: string;
  /** Public, cache-busted URL of the logo, or null. */
  logoUrl: string | null;
};

const DEFAULTS: Branding = {
  orgName: DEFAULT_ORG_NAME,
  primaryColor: DEFAULT_PRIMARY,
  primaryHover: darken(DEFAULT_PRIMARY, 0.15),
  logoUrl: null,
};

/**
 * Institution branding for every page. Cached and shared across requests; saving in Settings
 * refreshes it immediately (updateTag), and every server instance re-reads it within ~1 minute.
 * Contains nothing sensitive, so it may be shown on public pages like the login screen.
 */
export async function getBranding(): Promise<Branding> {
  "use cache";
  cacheTag(BRANDING_TAG);
  cacheLife("minutes");
  try {
    const [row] = await db.select().from(schema.branding).where(eq(schema.branding.id, 1));
    if (!row) return DEFAULTS;
    return {
      orgName: row.orgName,
      primaryColor: row.primaryColor,
      primaryHover: darken(row.primaryColor, 0.15),
      logoUrl: row.logoId ? `/api/branding/logo?v=${row.updatedAt.getTime()}` : null,
    };
  } catch (e) {
    // Never break every page over branding: fall back to defaults and retry on the next refresh.
    console.error("Branding could not be loaded", e instanceof Error ? e.message : e);
    return DEFAULTS;
  }
}

/** The stored logo id (for the logo route and replacing). */
export async function getLogoId(): Promise<string | null> {
  const [row] = await db.select({ logoId: schema.branding.logoId }).from(schema.branding).where(eq(schema.branding.id, 1));
  return row?.logoId ?? null;
}
