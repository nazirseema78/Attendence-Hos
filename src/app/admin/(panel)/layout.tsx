import { LogOut, UserCircle2 } from "lucide-react";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui";
import { getAdmin } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import { adminLogout } from "../login/actions";
import { BottomLinks, BottomNav, SidebarLinks, SidebarNav } from "./admin-nav";

export default async function AdminPanelLayout({ children }: LayoutProps<"/admin">) {
  const brand = await getBranding();
  return (
    <div className="flex min-h-screen flex-1">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy px-4 py-5 lg:flex">
        <div className="px-2 pb-6">
          <BrandMark brand={brand} inverted />
          <p className="mt-1 pl-12 text-xs text-navy-foreground/60">Admin</p>
        </div>
        {/* The active-link highlight reads the URL, so it streams in; links work immediately. */}
        <Suspense fallback={<SidebarLinks pathname="" />}>
          <SidebarNav />
        </Suspense>
        <div className="mt-auto space-y-3 border-t border-white/10 pt-4">
          <Suspense fallback={null}>
            <AdminName inverted />
          </Suspense>
          <form action={adminLogout}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-navy-foreground/70 hover:bg-white/5 hover:text-white"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile / tablet top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
          <BrandMark brand={brand} />
          <form action={adminLogout}>
            <Button variant="secondary" type="submit" className="h-9 px-3" aria-label="Log out">
              <LogOut aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </form>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>
      <Suspense fallback={<BottomLinks pathname="" />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}

async function AdminName({ inverted = false }: { inverted?: boolean }) {
  const admin = await getAdmin();
  if (!admin) return null;
  return (
    <p className={`flex items-center gap-2 px-3 text-sm ${inverted ? "text-navy-foreground/80" : "text-muted"}`}>
      <UserCircle2 aria-hidden className="h-4 w-4" />
      <span className="truncate">{admin.name}</span>
    </p>
  );
}
