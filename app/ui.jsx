"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../lib/supabase";

/* ---------- inline icons (stroke, 24 viewBox) ---------- */
const S = { fill: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
export const I = {
  pulse: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M2 12h4l3-8 4 16 3-8h6" /></svg>,
  home: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>,
  rocket: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2" /><path d="M12 15l-3-3 3.5-5.5C15 3 19 3 21 3c0 2 0 6-3.5 8.5L12 15z" /><circle cx="15" cy="9" r="1.4" /></svg>,
  chat: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /><path d="M8 11h8M8 14h5" /></svg>,
  chart: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M4 20V9M10 20V4M16 20v-7M21 20H3" /></svg>,
  doc: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h7M9 16h7" /></svg>,
  gear: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19 12a7 7 0 0 0-.15-1.4l2.1-1.6-2-3.4-2.5 1a7 7 0 0 0-2.4-1.4L13.6 2h-3.2l-.45 2.6a7 7 0 0 0-2.4 1.4l-2.5-1-2 3.4 2.1 1.6A7 7 0 0 0 5 12c0 .47.05.94.15 1.4l-2.1 1.6 2 3.4 2.5-1a7 7 0 0 0 2.4 1.4l.45 2.6h3.2l.45-2.6a7 7 0 0 0 2.4-1.4l2.5 1 2-3.4-2.1-1.6c.1-.46.15-.93.15-1.4z" /></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 2l8 3.5V12c0 5-3.5 8.7-8 10-4.5-1.3-8-5-8-10V5.5z" /><path d="M9 12l2.2 2.2L15.5 10" /></svg>,
  link: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></svg>,
  unlink: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7" /><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7" /><path d="M4 4l16 16" /></svg>,
  people: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 14.6c2.6.3 4.5 2.2 4.5 4.9" /></svg>,
  person: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20.5c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" /></svg>,
  pie: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M14 2.5V10h7.5A9 9 0 0 0 14 2.5z" /></svg>,
  hands: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M2 10l4-4 5 1.5L15 4l7 6-4 4" /><path d="M6 6l6 6 2-1.5" /><path d="M8 16l3 3M11 14l3 3M14 12l3 3" /></svg>,
  copy: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  qr: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z" /></svg>,
  info: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 11v6" /></svg>,
  plus: (p) => <svg viewBox="0 0 24 24" {...S} {...p}><path d="M12 5v14M5 12h14" /></svg>,
};

export const GROUP_META = {
  executive: { label: "Executives", chip: "c-red", icon: "person" },
  employee: { label: "Employees", chip: "c-teal", icon: "people" },
  customer: { label: "Customers", chip: "c-amber", icon: "people" },
  partner: { label: "Partners", chip: "c-blue", icon: "hands" },
  other: { label: "Other stakeholders", chip: "c-violet", icon: "people" },
};
export const GROUP_BAR = { executive: "var(--primary)", employee: "var(--teal)", customer: "var(--amber)", partner: "var(--blue)", other: "var(--violet)" };

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

/* ---------- App shell with dark sidebar ---------- */
export function Shell({ active, user, children }) {
  const router = useRouter();
  async function signOut(e) {
    e.preventDefault();
    await sb().auth.signOut();
    router.push("/login");
  }
  const nav = [
    { id: "overview", label: "Overview", href: "/dashboard", icon: I.home },
    { id: "campaigns", label: "Campaigns", href: "/campaigns", icon: I.rocket },
    { id: "responses", label: "Responses", href: "/responses", icon: I.chat },
    { id: "insights", label: "Insights", href: "/insights", icon: I.chart },
    { id: "reports", label: "Reports", soon: true, icon: I.doc },
    { id: "settings", label: "Settings", href: "/account", icon: I.gear },
  ];
  return (
    <div className="appshell">
      <aside className="sidebar">
        <Link href="/dashboard" className="sb-brand">
          <span className="sb-logo"><I.pulse /></span> InnoPulse
        </Link>
        <nav className="sb-nav">
          {nav.map((n) => n.soon ? (
            <span key={n.id} className="sb-item soon"><n.icon />{n.label}<span className="soon-tag">soon</span></span>
          ) : (
            <Link key={n.id} href={n.href} className={"sb-item" + (active === n.id ? " active" : "")}>
              <n.icon />{n.label}
            </Link>
          ))}
          {user ? (
            <a href="#" onClick={signOut} className="sb-item" style={{ marginTop: 8 }}>
              <I.person />Sign out
            </a>
          ) : null}
        </nav>
        <div className="sb-note"><I.shield /><span>Signed links keep stakeholder categories secure.</span></div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
