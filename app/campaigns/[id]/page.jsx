"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { TopBar, bandCls } from "../../ui";

const GROUP_LABEL = { executive: "Executives", employee: "Employees", customer: "Customers", partner: "Partners" };

export default function Campaign() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [c, setC] = useState(null);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const { data: camp, error: e1 } = await sb().from("fs_campaigns")
      .select("id, name, status, opens_at, closes_at, anonymity_threshold").eq("id", id).maybeSingle();
    if (e1 || !camp) { setErr(e1 ? e1.message : "Campaign not found (or you don't have access)."); return; }
    setC(camp);
    const [{ data: gs }, { data: ls }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", id),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count").eq("campaign_id", id),
    ]);
    setGroups(gs || []); setLinks(ls || []);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (jwt) {
      try {
        const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (r.ok) setResults(await r.json());
      } catch { /* results are best-effort */ }
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  function respondUrl(token) {
    return `${window.location.origin}/respond/${token}`;
  }
  async function copy(token) {
    try { await navigator.clipboard.writeText(respondUrl(token)); setCopied(token); setTimeout(() => setCopied(""), 1600); } catch {}
  }
  async function setStatus(status) {
    setBusy(true);
    const { error } = await sb().from("fs_campaigns").update({ status }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }

  if (err) return (<><TopBar user={user} /><div className="err">{err}</div></>);
  if (!c) return <p className="muted">Loading…</p>;

  const linkByGroup = {};
  for (const l of links) linkByGroup[l.group_id] = l;
  const resByGroup = {};
  if (results?.groups) for (const g of results.groups) resByGroup[g.id] = g;
  const pillars = results?.pillars || [];

  return (
    <>
      <TopBar user={user} />
      <h1>{c.name}</h1>
      <p className="small muted">
        <span className={"pill " + c.status}>{c.status}</span>{" "}
        · Anonymity threshold: {c.anonymity_threshold} response{c.anonymity_threshold === 1 ? "" : "s"} per group
      </p>
      <div style={{ margin: "12px 0 20px" }}>
        {c.status !== "open" ? (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus("open")}>Open collection</button>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus("closed")}>Close collection</button>
        )}
      </div>

      <div className="card">
        <h2>Campaign links</h2>
        <p className="muted small">
          Each stakeholder group has its own signed link — the URL carries only a random
          token, so respondents can&apos;t change which group they answer for. Share the
          right link with the right audience.
        </p>
        <table className="t">
          <thead><tr><th>Group</th><th>Link</th><th>Responses</th><th></th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const l = linkByGroup[g.id];
              const r = resByGroup[g.id];
              return (
                <tr key={g.id}>
                  <td><b>{GROUP_LABEL[g.type] || g.type}</b><div className="small muted">{g.label}</div></td>
                  <td>{l ? <code className="small">/respond/{l.token}</code> : <span className="muted">—</span>}</td>
                  <td>{r ? `${r.n} / ${g.target_n || "—"}` : "0"}</td>
                  <td>{l ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => copy(l.token)}>
                      {copied === l.token ? "Copied ✓" : "Copy link"}
                    </button>
                  ) : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Results by stakeholder group</h2>
        {!results ? (
          <p className="muted">Loading results…</p>
        ) : (
          <>
            <table className="t">
              <thead>
                <tr>
                  <th>Group</th><th>n</th>
                  {pillars.map((p) => <th key={p.id}>{p.short}</th>)}
                  <th>Don&apos;t know / N-A</th>
                </tr>
              </thead>
              <tbody>
                {(results.groups || []).map((g) => (
                  <tr key={g.id}>
                    <td><b>{GROUP_LABEL[g.type] || g.type}</b></td>
                    <td>{g.n}</td>
                    {g.suppressed ? (
                      <td colSpan={pillars.length + 1} className="muted small">
                        Hidden until at least {results.campaign.anonymity_threshold} responses (privacy protection)
                      </td>
                    ) : (
                      <>
                        {pillars.map((p) => (
                          <td key={p.id} className={"score " + bandCls(g.pillars[p.id])}>
                            {g.pillars[p.id] === null ? "—" : g.pillars[p.id]}
                          </td>
                        ))}
                        <td className="small muted">{g.dkna_pct}%</td>
                      </>
                    )}
                  </tr>
                ))}
                {results.overall && !results.overall.suppressed ? (
                  <tr>
                    <td><b>All groups</b></td>
                    <td>{results.overall.n}</td>
                    {pillars.map((p) => (
                      <td key={p.id} className={"score " + bandCls(results.overall.pillars[p.id])}>
                        {results.overall.pillars[p.id] === null ? "—" : results.overall.pillars[p.id]}
                      </td>
                    ))}
                    <td className="small"><b>Overall {results.overall.score ?? "—"}</b></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 10 }}>
              Scores are 0–100. Low &lt; 40 · Medium 40–69 · High 70+. Don&apos;t-know and
              not-applicable answers are excluded from scores and tracked as a data-quality signal.
            </p>
          </>
        )}
      </div>
    </>
  );
}
