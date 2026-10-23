import {
  BarChart3,
  ClipboardList,
  Gauge,
  type LucideIcon,
  Package,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { NavLink, useLocation } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useFilters } from "@/hooks/useFilters";
import { filterSearch } from "@/lib/filters";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Analytical pages share the global filters. */
  filtered: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Overview", icon: Gauge, filtered: true },
  { to: "/drivers", label: "Performance Drivers", icon: BarChart3, filtered: true },
  { to: "/products", label: "Product Performance", icon: Package, filtered: true },
  { to: "/operations", label: "Operations", icon: Truck, filtered: true },
  { to: "/actions", label: "Action Plan", icon: ClipboardList, filtered: false },
  { to: "/methodology", label: "Methodology & Data Quality", icon: ShieldCheck, filtered: false },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { filters } = useFilters();
  // Carry filters between analytical pages so the context is not lost.
  const search = filterSearch(filters);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Gauge className="size-4" aria-hidden />
          </div>
          <div className="grid leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">Control Tower</span>
            <span className="text-xs text-muted-foreground">Business performance</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analysis</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <NavLink to={{ pathname: item.to, search: item.filtered ? search : "" }} end={item.to === "/"}
                        aria-current={active ? "page" : undefined}>
                        <item.icon aria-hidden />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Sample Superstore data · read-only
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
