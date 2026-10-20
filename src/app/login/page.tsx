import type { Metadata } from "next";
import { BrandMark } from "@/components/brand";
import { Card } from "@/components/ui";
import { getBranding } from "@/lib/branding";
import { StudentLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Student login" };

export default async function StudentLoginPage() {
  const brand = await getBranding();
  return (
    <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-8 flex justify-center">
        <BrandMark brand={brand} size="lg" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Mark your attendance</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Log in with the phone number registered by your warden. Your account will be locked to this phone.
      </p>
      <Card>
        <StudentLoginForm />
      </Card>
    </main>
  );
}
