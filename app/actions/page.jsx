"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { Shell } from "../ui";
import { listOrgCampaigns, campaignRows } from "../lib/campaign-data";
import { actionBucket, canEdit, todayInZone } from "../lib/completion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Actions() {
  const router = useRouter();
  const [user, setUser] = useState(null),
    [membership, setMembership] = useState(null),
    [campaigns, setCampaigns] = useState([]),
    [actions, setActions] = useState([]),
    [team, setTeam] = useState([]),
    [zone, setZone] = useState("Africa/Johannesburg"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [scope, setScope] = useState("mine"),
    [filter, setFilter] = useState("active"),
    [campaign, setCampaign] = useState("all"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error } = await sb().auth.getUser();
      if (error) throw error;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setUser(data.user);
      const { campaigns: cs, membership: mem } = await listOrgCampaigns(
        data.user.id,
        "id,name,status,is_sandbox",
      );
      setMembership(mem);
      setCampaigns(cs);
      const [rows, directory, settings] = await Promise.all([
        campaignRows("fs_actions", "*", cs),
        sb().rpc("fs_team_directory", { p_org: mem.org_id }),
        sb()
          .from("fs_org_settings")
          .select("timezone")
          .eq("org_id", mem.org_id)
          .maybeSingle(),
      ]);
      if (directory.error || settings.error)
        throw directory.error || settings.error;
      setActions(rows);
      setTeam(directory.data || []);
      setZone(settings.data?.timezone || "Africa/Johannesburg");
    } catch (ex) {
      setError(ex.message || "Could not load actions.");
    } finally {
      setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);
  const today = todayInZone(zone),
    editable = canEdit(membership?.role),
    name = (id) => campaigns.find((c) => c.id === id)?.name || "Assessment";
  const visible = actions
    .filter(
      (a) =>
        (scope === "team" || a.assigned_to === user?.id) &&
        (campaign === "all" || a.campaign_id === campaign) &&
        (filter === "all" ||
          (filter === "active"
            ? a.status !== "done"
            : actionBucket(a, today) === filter)) &&
        (a.title + " " + name(a.campaign_id))
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.status === "done") - (b.status === "done") ||
        (a.due_on || "9999").localeCompare(b.due_on || "9999"),
    );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = editing;
      const owner =
        team.find((t) => t.user_id === row.assigned_to)?.label || null;
      const { data, error } = await sb()
        .from("fs_actions")
        .update({
          assigned_to: row.assigned_to || null,
          owner,
          due_on: row.due_on || null,
          status: row.status,
          notes: row.notes?.trim() || null,
        })
        .eq("id", row.id)
        .eq("campaign_id", row.campaign_id)
        .select("id")
        .single();
      if (error || !data)
        throw error || new Error("This action is no longer editable.");
      setEditing(null);
      await load();
    } catch (ex) {
      setError(ex.message || "Your changes could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const mine = actions.filter(
    (a) => a.assigned_to === user?.id && a.status !== "done",
  );
  return (
    <Shell active="actions" user={user}>
      <div className="pagehead">
        <div>
          <p className="eyebrow">FROM INSIGHT TO PROGRESS</p>
          <h1>My actions</h1>
          <p className="lead">
            Know what you own, what is due and what needs attention.
          </p>
        </div>
        <Link className="btn btn-primary" href="/insights/interventions">
          Plan actions
        </Link>
      </div>
      {error && (
        <div role="alert" className="err">
          {error}
          <Button variant="ghost" onClick={load}>
            Try again
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading actions…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <div>
                <div className="k">Assigned to me</div>
                <div className="v">{mine.length}</div>
              </div>
            </div>
            <div className="stat">
              <div>
                <div className="k">Overdue</div>
                <div className="v">
                  {
                    mine.filter((a) => actionBucket(a, today) === "overdue")
                      .length
                  }
                </div>
              </div>
            </div>
            <div className="stat">
              <div>
                <div className="k">Due today</div>
                <div className="v">
                  {
                    mine.filter((a) => actionBucket(a, today) === "today")
                      .length
                  }
                </div>
              </div>
            </div>
          </div>
          <div className="completion-filters">
            <label>
              View
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="mine">Assigned to me</option>
                <option value="team">Team actions</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  ["active", "Active"],
                  ["overdue", "Overdue"],
                  ["today", "Due today"],
                  ["upcoming", "Upcoming"],
                  ["unscheduled", "No due date"],
                  ["done", "Completed"],
                  ["all", "All"],
                ].map(([v, n]) => (
                  <option value={v} key={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assessment
              <select
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
              >
                <option value="all">All assessments</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.is_sandbox ? "[Sandbox] " : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an action"
              />
            </label>
          </div>
          {!visible.length ? (
            <div className="card completion-empty">
              <h2>
                {scope === "mine"
                  ? "Nothing on your list yet"
                  : "No actions in this view"}
              </h2>
              <p className="muted">
                {scope === "mine"
                  ? "Assign team members to actions in the intervention plan, or switch to Team actions."
                  : "Clear your filters or build a plan from your assessment findings."}
              </p>
            </div>
          ) : (
            <div className="action-list">
              {visible.map((a) => (
                <article className="card action-card" key={a.id}>
                  <div>
                    <p className="eyebrow">
                      {name(a.campaign_id)} · {a.pillar?.toUpperCase()}
                    </p>
                    <h2>{a.title}</h2>
                    <p className="small muted">
                      {team.find((t) => t.user_id === a.assigned_to)?.label ||
                        a.owner ||
                        "Unassigned"}{" "}
                      · {a.due_on ? `Due ${a.due_on}` : "No due date"} ·{" "}
                      {a.status.replaceAll("_", " ")}
                    </p>
                    {a.notes && <p className="action-notes">{a.notes}</p>}
                  </div>
                  <div className="action-tools">
                    <span className={`action-badge ${actionBucket(a, today)}`}>
                      {actionBucket(a, today).replace(
                        "unscheduled",
                        "No due date",
                      )}
                    </span>
                    <Link
                      href={`/insights/interventions?campaign=${a.campaign_id}`}
                    >
                      Open plan
                    </Link>
                    {editable && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing({ ...a })}
                      >
                        Edit action
                      </Button>
                    )}
                  </div>
                  {editing?.id === a.id && (
                    <form onSubmit={save} className="action-editor">
                      <fieldset disabled={busy}>
                        <div className="guide-fields">
                          <label>
                            Assigned to
                            <select
                              value={editing.assigned_to || ""}
                              onChange={(e) =>
                                setEditing((p) => ({
                                  ...p,
                                  assigned_to: e.target.value,
                                }))
                              }
                            >
                              <option value="">Unassigned</option>
                              {team
                                .filter((t) => canEdit(t.role))
                                .map((t) => (
                                  <option key={t.user_id} value={t.user_id}>
                                    {t.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Due date
                            <Input
                              type="date"
                              value={editing.due_on || ""}
                              onChange={(e) =>
                                setEditing((p) => ({
                                  ...p,
                                  due_on: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Status
                            <select
                              value={editing.status}
                              onChange={(e) =>
                                setEditing((p) => ({
                                  ...p,
                                  status: e.target.value,
                                }))
                              }
                            >
                              <option value="not_started">Not started</option>
                              <option value="in_progress">In progress</option>
                              <option value="done">Completed</option>
                            </select>
                          </label>
                        </div>
                        <label className="f" htmlFor={`notes-${a.id}`}>
                          Progress notes
                        </label>
                        <Textarea
                          id={`notes-${a.id}`}
                          maxLength={4000}
                          value={editing.notes || ""}
                          onChange={(e) =>
                            setEditing((p) => ({ ...p, notes: e.target.value }))
                          }
                        />
                        <div className="guide-controls">
                          <Button>{busy ? "Saving…" : "Save action"}</Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </fieldset>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
          <p className="small muted">
            Due dates use {zone.replaceAll("_", " ")}. Completed actions remain
            in your history.
          </p>
        </>
      )}
    </Shell>
  );
}
