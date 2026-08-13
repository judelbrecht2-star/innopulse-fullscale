"use client";
/* The /settings shell: app sidebar (Shell) + a secondary settings nav.
   Everything under /settings shares one auth check and one org-settings fetch
   via SettingsProvider, so switching between the eight pages does not re-query
   Supabase each time. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shell } from "../ui";
import { SettingsProvider, useSettings } from "./context";
import { Badge } from "@/components/ui/badge";
import {
  User, Lock, Building, Group, ShieldCheck, Settings as SettingsIcon, Bell, ClipboardCheck,
} from "iconoir-react";

const NAV = [
  { href: "/settings/profile", label: "Profile", Icon: User, blurb: "You and your active organisation" },
  { href: "/settings/security", label: "Security", Icon: Lock, blurb: "Password and two-factor" },
  { href: "/settings/organization", label: "Organisation", Icon: Building, blurb: "Name, locale, contacts", owner: true },
  { href: "/settings/team", label: "Team", Icon: Group, blurb: "Members, roles, invitations", manage: true },
  { href: "/settings/privacy", label: "Privacy", Icon: ShieldCheck, blurb: "Retention, exports, MFA policy", owner: true },
  { href: "/settings/defaults", label: "Campaign defaults", Icon: SettingsIcon, blurb: "What new campaigns inherit", owner: true },
  { href: "/settings/notifications", label: "Notifications", Icon: Bell, blurb: "Reminder emails" },
  { href: "/settings/audit", label: "Audit log", Icon: ClipboardCheck, blurb: "Who did what", manage: true },
];

function SettingsNav() {
  const pathname = usePathname();
  const { role, canManage, isOwner } = useSettings();
  const visible = NAV.filter((n) => (n.owner ? isOwner : n.manage ? canManage : true));
  return (
    <nav aria-label="Settings sections" className="shrink-0 md:w-60">
      <div className="mb-3 hidden px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:block">
        Settings
      </div>
      <ul className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0">
        {visible.map((n) => {
          const active = pathname === n.href;
          return (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors " +
                  (active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground")
                }
              >
                <n.Icon width={16} height={16} className="shrink-0" />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {role ? (
        <p className="mt-4 hidden px-3 text-xs text-muted-foreground md:block">
          Signed in as <Badge variant="outline" data-tone="draft">{role}</Badge>
          <br />
          Sections you cannot change are hidden.
        </p>
      ) : null}
    </nav>
  );
}

function Frame({ children }) {
  const { user } = useSettings();
  return (
    <Shell active="settings" user={user}>
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Shell>
  );
}

export default function SettingsLayout({ children }) {
  return (
    <SettingsProvider>
      <Frame>{children}</Frame>
    </SettingsProvider>
  );
}
