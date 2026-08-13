"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, Home, Rocket, ChatLines, StatsUpSquare, Page, Settings,
  ShieldCheck, Link as LinkIcon, LinkSlash, Group, User, ReportColumns, Community, Copy, QrCode,
  InfoCircle, Plus, LogOut,
} from "iconoir-react";
import { sb } from "../lib/supabase";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/* ---------------------------------------------------------------------------
   Icons — Iconoir (iconoir.com).
   so every existing call site keeps working; each key renders the Iconoir icon.
   --------------------------------------------------------------------------- */
const ic = (Cmp) => function Icon(p) { return <Cmp {...p} />; };
export const I = {
  pulse: ic(Activity),
  home: ic(Home),
  rocket: ic(Rocket),
  chat: ic(ChatLines),
  chart: ic(StatsUpSquare),
  doc: ic(Page),
  gear: ic(Settings),
  shield: ic(ShieldCheck),
  link: ic(LinkIcon),
  unlink: ic(LinkSlash),
  people: ic(Group),
  person: ic(User),
  pie: ic(ReportColumns),
  hands: ic(Community),
  copy: ic(Copy),
  qr: ic(QrCode),
  info: ic(InfoCircle),
  plus: ic(Plus),
};

export const GROUP_META = {
  executive: { label: "Executives", chip: "c-red", icon: "person", Icon: User },
  employee: { label: "Employees", chip: "c-teal", icon: "people", Icon: Group },
  customer: { label: "Customers", chip: "c-amber", icon: "people", Icon: Group },
  partner: { label: "Partners", chip: "c-blue", icon: "hands", Icon: Community },
  other: { label: "Other stakeholders", chip: "c-violet", icon: "people", Icon: Group },
};
export const GROUP_BAR = {
  executive: "var(--primary)", employee: "var(--tgs-teal)", customer: "var(--tgs-amber)",
  partner: "var(--tgs-blue)", other: "var(--tgs-violet)",
};

export function groupName(g) {
  if (!g) return "";
  if (g.type === "other") return g.label || "Other stakeholders";
  return GROUP_META[g.type]?.label || g.type;
}

export function bandCls(v) {
  if (v === null || v === undefined) return "";
  if (v < 40) return "band-low";
  if (v < 70) return "band-med";
  return "band-high";
}

/* Single source of truth for score bands (audit F16) */
export function bandWord(v) { return v < 40 ? "Low" : v < 70 ? "Medium" : "High"; }
export function bandOf(v) { return v < 40 ? "low" : v < 70 ? "medium" : "high"; }

const NAV = [
  { id: "overview", label: "Overview", href: "/dashboard", Icon: Home },
  { id: "campaigns", label: "Campaigns", href: "/campaigns", Icon: Rocket },
  { id: "responses", label: "Responses", href: "/responses", Icon: ChatLines },
  { id: "insights", label: "Insights", href: "/insights", Icon: StatsUpSquare },
  { id: "reports", label: "Reports", href: "/reports", Icon: Page },
  { id: "settings", label: "Settings", href: "/settings/profile", Icon: Settings },
];

/* ---------- App shell — shadcn/ui Sidebar, dark TGS treatment ---------- */
export function Shell({ active, user, children }) {
  const router = useRouter();
  async function signOut(e) {
    e.preventDefault();
    await sb().auth.signOut();
    router.push("/login");
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" className="hover:bg-sidebar-accent">
                <Link href="/dashboard">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Activity className="size-4" />
                  </span>
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold text-sidebar-accent-foreground">InnoPulse</span>
                    <span className="truncate text-xs">Full-Scale</span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton asChild isActive={active === n.id} tooltip={n.label}>
                    <Link href={n.href}><n.Icon />{n.label}</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            {user ? (
              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut} tooltip="Sign out">
                  <LogOut />Sign out
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          <div className="flex gap-2 rounded-md p-2 text-xs text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
            <ShieldCheck className="size-4 shrink-0" />
            <span>Signed links keep stakeholder categories secure.</span>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-muted-foreground">
            {NAV.find((n) => n.id === active)?.label || "InnoPulse Full-Scale"}
          </span>
        </header>
        <main className="main flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
