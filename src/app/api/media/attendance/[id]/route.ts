import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdmin } from "@/lib/auth";
import { parseSize, proxyMedia, UUID_RE } from "@/lib/media";

/** Admin-only: the selfie attached to an attendance record. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/attendance/[id]">) {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const [record] = await db
    .select({ selfieId: schema.attendance.selfieId })
    .from(schema.attendance)
    .where(eq(schema.attendance.id, id));
  if (!record?.selfieId) return new Response("Not found", { status: 404 });

  return proxyMedia(record.selfieId, parseSize(request));
}
