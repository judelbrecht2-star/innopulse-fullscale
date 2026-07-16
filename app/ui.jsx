"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../lib/supabase";

export function TopBar({ user }) {
  const router = useRouter();
  async function signOut() {
    await sb().auth.signOut();
    router.push("/login");
  }
  return (
    <div className="topbar">
      <Link href="/dashboard" className="brand">
        <b>Inno<span>Pulse</span></b>
        <span className="tag">Full-Scale</span>
      </Link>
      <div className="nav">
        {user ? (
          <>
            <span className="small muted">{user.email}</span>
            <Link href="/account">Account</Link>
            <a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}>Sign out</a>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function bandCls(v) {
  if (v === null || v === undefined) return "";
  if (v < 40) return "band-low";
  if (v < 70) return "band-med";
  return "band-high";
}
