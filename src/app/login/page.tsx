import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { StudentLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Student login" };

export default function StudentLoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold">Mark your attendance</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Log in with the phone number registered by your admin. Your account will be locked to this phone.
      </p>
      <Card>
        <StudentLoginForm />
      </Card>
    </main>
  );
}
