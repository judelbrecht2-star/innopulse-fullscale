"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "../../../lib/supabase";
import { Shell } from "../../ui";

const GROUP_DEFS = [
  { type: "executive", label: "Executives & leadership", hint: "Board, exco, senior leaders", def: 5 },
  { type: "employee", label: "Employees", hint: "Staff across departments", def: 20 },
  { type: "customer", label: "Customers", hint: "Clients who experience your innovation", def: 10 },
  { type: "partner", label: "Service providers & partners", hint: "Suppliers, consultants, ecosystem", def: 5 },
];

function randToken() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export default function NewCampaign() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [threshold, setThreshold] = useState(5);
  const [groups, setGroups] = useState(
    Object.fromEntries(GROUP_DEFS.map((g) => [g.type, { on: true, target: g.def }]))
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: mem } = await sb().from("fs_memberships")
        .select("role, org_id, fs_orgs(id, name)").limit(1).maybeSingle();
      if (mem) { setOrg(mem.fs_orgs); setRole(mem.role); }
    })();
  }, [router]);

  const canCreate = role === "owner" || role === "manager";

  async function create(e) {
    e.preventDefault();
    setErr("");
    const chosen = GROUP_DEFS.filter((g) => groups[g.type].on);
    if (!name.trim()) { setErr("Give the campaign a name."); return; }
    if (chosen.length === 0) { setErr("Choose at least one stakeholder group."); return; }
    setBusy(true);
    try {
      const { data: qv, error: eq } = await sb()
        .from("fs_questionnaire_versions").select("id").eq("version", "1.0").single();
      if (eq || !qv) throw new Error("Questionnaire version not found.");
      const opens = new Date();
      const closes = new Date(Date.now() + Number(days || 30) * 86400000);
      const { data: camp, error: e1 } = await sb().from("fs_campaigns").insert({
        org_id: org.id, name: name.trim(), status: "open",
        questionnaire_version_id: qv.id,
        opens_at: opens.toISOString(), closes_at: closes.toISOString(),
        anonymity_threshold: Math.max(1, Number(threshold || 5)),
        created_by: user.id,
      }).select("id").single();
      if (e1 || !camp) throw new Error(e1 ? e1.message : "Could not create campaign.");

      const { data: gs, error: e2 } = await sb().from("fs_groups").insert(
        chosen.map((g) => ({
          campaign_id: camp.id, type: g.type, label: g.label,
          target_n: Math.max(0, Number(groups[g.type].target || 0)),
        }))
      ).select("id");
      if (e2) throw new Error(e2.message);

      const { error: e3 } = await sb().from("fs_links").insert(
        (gs || []).map((g) => ({
          campaign_id: camp.id, group_id: g.id, token: randToken(), mode: "group",
        }))
      );
      if (e3) throw new Error(e3.message);

      await sb().from("fs_audit").insert({
        org_id: org.id, actor: user.id, action: "campaign.create",
        entity: "fs_campaigns", entity_id: camp.id,
      });
      router.push(`/campaigns/${camp.id}`);
    } catch (ex) {
      setErr(String(ex.message || ex));
      setBusy(false);
    }
  }

  if (!user) return <p className="muted">Loading…</p>;
  return (
    <Shell active="campaigns" user={user}>
      <div className="crumbs"><a href="/campaigns">Campaigns</a> / <b>New</b></div>
      <h1>New assessment campaign</h1>
      <p className="muted small">{org ? org.name : ""}</p>
      {!canCreate ? (
        <div className="err">Your role ({role || "none"}) can&apos;t create campaigns — ask an owner or assessment manager.</div>
      ) : (
        <form onSubmit={create}>
          <div className="card" style={{ maxWidth: 640 }}>
            <label className="f">Campaign name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2026 H2 innovation health check" />
            <div className="grid2" style={{ marginTop: 6 }}>
              <div>
                <label className="f">Collection window (days)</label>
                <input type="text" inputMode="numeric" value={days}
                  onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div>
                <label className="f">Anonymity threshold (min responses per group)</label>
                <input type="text" inputMode="numeric" value={threshold}
                  onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Groups below the threshold are hidden in results to protect respondents.
              Recommended: 5.
            </p>
          </div>

          <div className="card" style={{ maxWidth: 640 }}>
            <h2>Stakeholder groups</h2>
            {GROUP_DEFS.map((g) => (
              <div key={g.type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                  <input type="checkbox" checked={groups[g.type].on}
                    onChange={(e) => setGroups((s) => ({ ...s, [g.type]: { ...s[g.type], on: e.target.checked } }))} />
                  <span><b>{g.label}</b><span className="small muted"> — {g.hint}</span></span>
                </label>
                <span className="small muted">target</span>
                <input type="text" inputMode="numeric" value={groups[g.type].target}
                  onChange={(e) => setGroups((s) => ({ ...s, [g.type]: { ...s[g.type], target: e.target.value.replace(/\D/g, "") } }))}
                  style={{ width: 70 }} />
              </div>
            ))}
            <p className="small muted" style={{ marginTop: 10 }}>
              Each selected group gets its own signed link the moment the campaign is created.
            </p>
          </div>

          {err ? <div className="err">{err}</div> : null}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create campaign & generate links"}
          </button>
        </form>
      )}
    </Shell>
  );
}
