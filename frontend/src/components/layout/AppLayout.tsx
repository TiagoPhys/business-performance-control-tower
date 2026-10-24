import { Outlet, useLocation } from "react-router";
import { FilterBar } from "@/components/filters/FilterBar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar, NAV_ITEMS } from "./AppSidebar";

export function AppLayout() {
  const { pathname } = useLocation();
  const current = NAV_ITEMS.find((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)));

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset>
        {/* Sticky only on larger screens: on phones the filters would cover a third of the view. */}
        <header className="z-10 border-b bg-background md:sticky md:top-0">
          <div className="flex h-12 items-center gap-2 px-4">
            <SidebarTrigger aria-label="Toggle navigation" />
            <Separator orientation="vertical" className="mr-1 h-4" />
            <p className="truncate text-sm font-medium">{current?.label ?? "Business Performance Control Tower"}</p>
          </div>
          {current?.filtered && (
            <div className="border-t px-4 py-3">
              <FilterBar />
            </div>
          )}
        </header>
        {/* SidebarInset is already the <main> landmark; this is the skip-link target. */}
        <div id="main" tabIndex={-1} className="flex-1 space-y-6 p-4 outline-none md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
