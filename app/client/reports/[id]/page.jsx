"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { sb } from "../../../../lib/supabase";
import ClientReportPresentation from "../../../components/client-report-presentation";
export default function ClientReport() {
  const { id } = useParams(),
    router = useRouter();
  const [report, setReport] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await sb().auth.getUser();
        if (u.error) throw u.error;
        if (!u.data.user) {
          router.replace("/login");
          return;
        }
        const r = await sb()
          .from("fs_reports")
          .select("*")
          .eq("id", id)
          .single();
        if (
          r.error ||
          !r.data ||
          !["approved", "issued"].includes(r.data.approval_state) ||
          !r.data.snapshot ||
          r.data.rtype !== "executive"
        )
          throw new Error(
            "This approved report is unavailable to your account. Ask your workspace owner for access.",
          );
        if (alive) setReport(r.data);
      } catch (ex) {
        if (alive) setError(ex.message || "Could not open the report.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, router]);
  if (error)
    return (
      <main className="client-report">
        <div className="err" role="alert">
          {error}
        </div>
        <Link href="/reports">Back to reports</Link>
      </main>
    );
  if (!report)
    return (
      <main className="client-report">
        <p role="status">Opening your report…</p>
      </main>
    );
  return <ClientReportPresentation report={report} />;
}
