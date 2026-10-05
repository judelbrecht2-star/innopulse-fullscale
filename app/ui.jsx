"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { activeMembership, switchOrg } from "./lib/org";
import { campaignHref } from "./lib/campaign-context";
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
export function Shell({ active, user, campaignId = null, children }) {
  const router = useRouter();
  const [membership, setMembership] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [shellError, setShellError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (user) activeMembership(user.id).then((m) => { if (!cancelled) setMembership(m); })
      .catch(() => { if (!cancelled) setShellError("Could not load organisation details. Please refresh."); });
    return () => { cancelled = true; };
  }, [user]);
  async function signOut(e) {
    e.preventDefault();
    setSigningOut(true); setShellError("");
    try {
      const { error } = await sb().auth.signOut();
      if (error) throw error;
      router.replace("/login");
    } catch { setShellError("Could not sign out. Check your connection and try again."); }
    finally { setSigningOut(false); }
  }

  return (
    <SidebarProvider>
      <a className="skip-link" href="#main-content">Skip to content</a>
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
                    <Link href={["responses", "insights", "reports"].includes(n.id) ? campaignHref(n.href, campaignId) : n.href} aria-current={active === n.id ? "page" : undefined}><n.Icon />{n.label}</Link>
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
                <SidebarMenuButton onClick={signOut} disabled={signingOut} tooltip="Sign out">
                  <LogOut />{signingOut ? "Signing out…" : "Sign out"}
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
          {membership ? <div className="ml-auto min-w-0">
            {membership.memberships.length > 1 ? <select aria-label="Active organisation" className="org-switcher"
              value={membership.org_id} onChange={(e) => switchOrg(e.target.value)}>
              {membership.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.fs_orgs.name}</option>)}
            </select> : <span className="text-sm text-muted-foreground truncate">{membership.fs_orgs.name}</span>}
          </div> : null}
        </header>
        <main id="main-content" tabIndex={-1} className="main flex-1 p-6">
          {shellError ? <div role="alert" className="err">{shellError}</div> : null}{children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
