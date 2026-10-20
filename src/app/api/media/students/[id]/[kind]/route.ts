import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdmin } from "@/lib/auth";
import { parseSize, proxyMedia, UUID_RE } from "@/lib/media";

/** Admin-only: a student's registered photo or ID card. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/students/[id]/[kind]">) {
  if (!(await getAdmin())) return new Response("Unauthorized", { status: 401 });

  const { id, kind } = await ctx.params;
  if (!UUID_RE.test(id) || (kind !== "photo" && kind !== "id-card")) {
    return new Response("Not found", { status: 404 });
  }

  const [student] = await db
    .select({
      photoId: schema.students.photoId,
      idCardId: schema.students.idCardId,
      idCardFormat: schema.students.idCardFormat,
    })
    .from(schema.students)
    .where(eq(schema.students.id, id));

  const publicId = kind === "photo" ? student?.photoId : student?.idCardId;
  if (!publicId) return new Response("Not found", { status: 404 });

  return proxyMedia(publicId, parseSize(request), kind === "id-card" && student?.idCardFormat === "pdf");
}
