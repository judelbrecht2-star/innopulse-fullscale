"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { activeMembership } from "../lib/org";
import { Shell } from "../ui";
import { Button } from "@/components/ui/button";
export default function Notifications() {
  const router = useRouter();
  const [user, setUser] = useState(null),
    [org, setOrg] = useState(null),
    [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(false);
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
      const m = await activeMembership(data.user.id);
      if (!m) throw new Error("Workspace access required.");
      setOrg(m.org_id);
      const refresh = await sb().rpc("fs_refresh_notifications", {
        p_org: m.org_id,
      });
      if (refresh.error) throw refresh.error;
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const r = await sb()
          .from("fs_notifications")
          .select("*")
          .eq("org_id", m.org_id)
          .eq("user_id", data.user.id)
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (r.error) throw r.error;
        rows.push(...r.data);
        if (r.data.length < 500) break;
      }
      setItems(rows);
    } catch (ex) {
      setError(ex.message || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);
  async function read(id) {
    setBusy(true);
    setError("");
    try {
      let q = sb()
        .from("fs_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("org_id", org);
      q = id ? q.eq("id", id) : q.is("read_at", null);
      const r = await q.select("id");
      if (r.error) throw r.error;
      setItems((p) =>
        p.map((x) =>
          !id || x.id === id ? { ...x, read_at: new Date().toISOString() } : x,
        ),
      );
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  }
  const visible = items.filter((n) => filter === "all" || !n.read_at);
  return (
    <Shell active="notifications" user={user}>
      <div className="pagehead">
        <div>
          <p className="eyebrow">KEEP YOUR WORK MOVING</p>
          <h1>Inbox</h1>
          <p className="lead">
            Report decisions, collection milestones and the actions that need
            you.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/settings/notifications">
          Notification preferences
        </Link>
      </div>
      {error && (
        <div role="alert" className="err">
          {error}
          <Button onClick={load}>Try again</Button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading your inbox…</p>
      ) : (
        <>
          <div className="completion-filters">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              variant={filter === "unread" ? "default" : "outline"}
              onClick={() => setFilter("unread")}
            >
              Unread ({items.filter((n) => !n.read_at).length})
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !items.some((n) => !n.read_at)}
              onClick={() => read(null)}
            >
              Mark all read
            </Button>
            <Button variant="ghost" onClick={load}>
              Refresh
            </Button>
          </div>
          {!visible.length ? (
            <div className="card completion-empty">
              <h2>You’re caught up</h2>
              <p className="muted">
                New updates will appear here as your workspace progresses.
              </p>
            </div>
          ) : (
            visible.map((n) => (
              <article
                className={`card inbox-item ${!n.read_at ? "unread" : ""}`}
                key={n.id}
              >
                <div>
                  <p className="eyebrow">
                    {n.kind} · {new Date(n.created_at).toLocaleDateString()}
                  </p>
                  <h2>{n.title}</h2>
                  <p>{n.body}</p>
                  <Link href={n.href}>Open →</Link>
                </div>
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => read(n.id)}
                  >
                    Mark read
                  </Button>
                )}
              </article>
            ))
          )}
        </>
      )}
    </Shell>
  );
}
