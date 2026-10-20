import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Skeleton } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createStudent } from "../actions";
import { StudentForm } from "../student-form";

export const metadata: Metadata = { title: "Add student" };

export default function NewStudentPage() {
  return (
    <div className="space-y-4">
      <Link href="/admin/students" className="text-sm text-muted hover:text-foreground">
        ← Students
      </Link>
      <h1 className="text-2xl font-semibold">Add student</h1>
      <Card>
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <NewStudent />
        </Suspense>
      </Card>
    </div>
  );
}

async function NewStudent() {
  await requireAdmin();
  return <StudentForm action={createStudent} mode="create" />;
}
