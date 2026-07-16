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
  { type: "other", label: "Other stakeholders", hint: "Board, unions, regulators, community — answers the outward-facing questions", def: 5, off: true },
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
    Object.fromEntries(GROUP_DEFS.map((g) => [g.type, { on: !g.off, target: g.def, label: g.label }]))
  );
  const [versions, setVersions] = useState([]);
  const [verId, setVerId] = useState("");
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
      // F3: campaigns choose their questionnaire version — no more hardcoded v1.0
      const { data: vs } = await sb().from("fs_questionnaire_versions")
        .select("id, version").order("created_at", { ascending: false });
      setVersions(vs || []);
      if (vs && vs.length) setVerId(vs[0].id);
    })();
  }, [router]);

  const canCreate = role === "owner" || role === "manager";

  async function create(e) {
    e.preventDefault();
    setErr("");
    const chosen = GROUP_DEFS.filter((g) => groups[g.type].on);
    if (!name.trim()) { setErr("Give the campaign a name."); return; }
    if (chosen.length === 0) { setErr("Choose at least one stakeholder group."); return; }
    if (!verId) { setErr("Choose a questionnaire version."); return; }
    setBusy(true);
    try {
      const opens = new Date();
      const closes = new Date(Date.now() + Number(days || 30) * 86400000);
      const { data: camp, error: e1 } = await sb().from("fs_campaigns").insert({
        org_id: org.id, name: name.trim(), status: "open",
        questionnaire_version_id: verId,
        opens_at: opens.toISOString(), closes_at: closes.toISOString(),
        anonymity_threshold: Math.max(4, Number(threshold || 5)),
        created_by: user.id,
      }).select("id").single();
      if (e1 || !camp) throw new Error(e1 ? e1.message : "Could not create campaign.");

      const { data: gs, error: e2 } = await sb().from("fs_groups").insert(
        chosen.map((g) => ({
          campaign_id: camp.id, type: g.type,
          label: (groups[g.type].label || g.label).trim() || g.label,
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
              Minimum 4 — recommended 5. This floor is also enforced server-side.
            </p>
            <label className="f" style={{ marginTop: 10 }}>Questionnaire</label>
            <select value={verId} onChange={(e) => setVerId(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version.includes("draft")
                    ? `v${v.version.replace("-draft", "")} — stakeholder-tailored (draft, awaiting sign-off)`
                    : `v${v.version} — classic (same 50 questions for every group)`}
                </option>
              ))}
            </select>
            <p className="small muted" style={{ marginTop: 6 }}>
              The tailored version serves each stakeholder group only the questions written
              for them; the classic version shows everyone the same set.
            </p>
          </div>

          <div className="card" style={{ maxWidth: 640 }}>
            <h2>Stakeholder groups</h2>
            {GROUP_DEFS.map((g) => (
              <div key={g.type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                  <input type="checkbox" checked={groups[g.type].on}
                    onChange={(e) => setGroups((s) => ({ ...s, [g.type]: { ...s[g.type], on: e.target.checked } }))} />
                  {g.type === "other" ? (
                    <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="text" value={groups[g.type].label}
                        onClick={(e) => e.preventDefault()}
                        onChange={(e) => setGroups((s) => ({ ...s, [g.type]: { ...s[g.type], label: e.target.value } }))}
                        placeholder="Type the stakeholder name, e.g. Board members"
                        style={{ maxWidth: 320 }} />
                      <span className="small muted">{g.hint}</span>
                    </span>
                  ) : (
                    <span><b>{g.label}</b><span className="small muted"> — {g.hint}</span></span>
                  )}
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
