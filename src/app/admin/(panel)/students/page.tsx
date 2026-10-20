import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { asc, ilike, or } from "drizzle-orm";
import { buttonClass, Card, Input, Skeleton } from "@/components/ui";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Students" };

export default function StudentsPage(props: PageProps<"/admin/students">) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Students</h1>
        <Link href="/admin/students/new" className={buttonClass()}>
          + Add student
        </Link>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <StudentList searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function StudentList({ searchParams }: Pick<PageProps<"/admin/students">, "searchParams">) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  const digits = query.replace(/\D/g, "");
  const rows = await db
    .select({
      id: schema.students.id,
      name: schema.students.name,
      phone: schema.students.phone,
      active: schema.students.active,
      deviceBoundAt: schema.students.deviceBoundAt,
      photoId: schema.students.photoId,
    })
    .from(schema.students)
    .where(
      query
        ? or(
            ilike(schema.students.name, `%${query}%`),
            digits.length >= 3 ? ilike(schema.students.phone, `%${digits}%`) : undefined,
          )
        : undefined,
    )
    .orderBy(asc(schema.students.name));

  return (
    <Card className="space-y-4">
      <form className="flex gap-2">
        <Input name="q" defaultValue={query} placeholder="Search by name or phone" className="max-w-sm" />
        <button className={buttonClass("secondary")}>Search</button>
      </form>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {query ? "No students match your search." : "No students yet. Add your first student."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/students/${s.id}`} className="flex items-center gap-3 py-3 hover:bg-background">
                <Avatar studentId={s.id} hasPhoto={Boolean(s.photoId)} name={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-sm text-muted">{formatPhone(s.phone)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  {!s.active && <span className="rounded-full bg-danger-bg px-2 py-0.5 text-danger">Inactive</span>}
                  <span className="text-muted">{s.deviceBoundAt ? "Phone linked" : "Not logged in yet"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Avatar({ studentId, hasPhoto, name }: { studentId: string; hasPhoto: boolean; name: string }) {
  if (!hasPhoto) {
    return (
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background text-sm font-medium text-muted">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- private media served through our authenticated route
    <img
      src={`/api/media/students/${studentId}/photo?size=thumb`}
      alt=""
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-full object-cover"
    />
  );
}
