"use client";
/* /account has been replaced by /settings/*.
   Everything this page used to do now lives on a dedicated route:
     profile   — name, email, active organisation
     security  — password, two-factor, sessions
     team      — members, roles, invitations
   The redirect stays because bookmarks, the old sidebar link and any invite
   email that shipped with /account in it must keep working. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AccountRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/profile"); }, [router]);
  return <p className="muted" style={{ padding: 24 }}>Taking you to Settings…</p>;
}
