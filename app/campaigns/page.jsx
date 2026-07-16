"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { Shell, I } from "../ui";

export default function Campaigns() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: mem } = await sb().from("fs_memberships").select("role").limit(1).maybeSingle();
      setRole(mem?.role || "");
      const { data: cs, error } = await sb().from("fs_campaigns")
        .select("id, name, status, opens_at, closes_at, created_at")
        .order("created_at", { ascending: false });
      if (error) setErr(error.message);
      setCampaigns(cs || []);
      setLoading(false);
    })();
  }, [router]);

  const canManage = role === "owner" || role === "manager";

  return (
    <Shell active="campaigns" user={user}>
      {loading ? <p className="muted">Loading…</p> : (
        <>
          <div className="crumbs"><b>Campaigns</b></div>
          <div className="pagehead">
            <div>
              <h1>Campaigns</h1>
              <p className="lead">Each campaign collects one assessment cycle across your stakeholder groups.</p>
            </div>
            {canManage ? (
              <Link className="btn btn-primary" href="/campaigns/new"><I.plus style={{ width: 16, height: 16, stroke: "#fff" }} /> New campaign</Link>
            ) : null}
          </div>
          {err ? <div className="err">{err}</div> : null}
          <div className="card">
            {campaigns.length === 0 ? <p className="muted">No campaigns yet.</p> : (
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
                      <td style={{ textAlign: "right" }}><Link className="btn btn-ghost btn-sm" href={`/campaigns/${c.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
