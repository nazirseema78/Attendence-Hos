import type { Metadata } from "next";
import { BrandMark } from "@/components/brand";
import { Card } from "@/components/ui";
import { getBranding } from "@/lib/branding";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin login" };

export default async function AdminLoginPage() {
  const brand = await getBranding();
  return (
    <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-8 flex justify-center">
        <BrandMark brand={brand} size="lg" />
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Admin login</h1>
      <Card>
        <AdminLoginForm />
      </Card>
    </main>
  );
}
