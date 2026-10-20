import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui";
import { getAdmin } from "@/lib/auth";
import { adminLogout } from "../login/actions";

const nav = [
  { href: "/admin", label: "Today" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/history", label: "History" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export default function AdminPanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Attendance Admin</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-muted hover:bg-background hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Suspense fallback={null}>
              <AdminName />
            </Suspense>
            <form action={adminLogout}>
              <Button variant="secondary" type="submit" className="h-8 px-3">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

async function AdminName() {
  const admin = await getAdmin();
  return admin ? <span className="text-muted">{admin.name}</span> : null;
}
