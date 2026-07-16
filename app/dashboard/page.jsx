"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { TopBar } from "../ui";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: mem, error: e1 } = await sb()
        .from("fs_memberships").select("role, org_id, fs_orgs(id, name)")
        .limit(1).maybeSingle();
      if (e1) { setErr(e1.message); setLoading(false); return; }
      if (!mem) { setErr("Your user isn't linked to an organisation yet."); setLoading(false); return; }
      setOrg(mem.fs_orgs); setRole(mem.role);
      const { data: cs, error: e2 } = await sb()
        .from("fs_campaigns")
        .select("id, name, status, opens_at, closes_at, anonymity_threshold, created_at")
        .order("created_at", { ascending: false });
      if (e2) setErr(e2.message);
      setCampaigns(cs || []);
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <p className="muted">Loading…</p>;
  return (
    <>
      <TopBar user={user} />
      <h1>{org ? org.name : "Dashboard"}</h1>
      <p className="muted small">Your role: <b>{role || "—"}</b></p>
      {err ? <div className="err">{err}</div> : null}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Assessment campaigns</h2>
          {role === "owner" || role === "manager" ? (
            <Link className="btn btn-primary btn-sm" href="/campaigns/new">+ New campaign</Link>
          ) : null}
        </div>
        {campaigns.length === 0 ? (
          <p className="muted">No campaigns yet.</p>
        ) : (
          <table className="t">
            <thead><tr><th>Campaign</th><th>Status</th><th>Window</th><th></th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td><span className={"pill " + c.status}>{c.status}</span></td>
                  <td className="small muted">
                    {c.opens_at ? new Date(c.opens_at).toLocaleDateString() : "—"} →{" "}
                    {c.closes_at ? new Date(c.closes_at).toLocaleDateString() : "—"}
                  </td>
                  <td><Link className="btn btn-ghost btn-sm" href={`/campaigns/${c.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="small muted">
        Create a campaign, share each stakeholder group&apos;s link, and results
        aggregate live with anonymity protection.
      </p>
    </>
  );
}
