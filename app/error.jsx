"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }) {
  return <div className="rshell"><div className="card" style={{ maxWidth: 560, margin: "60px auto" }}>
    <h1>We couldn&apos;t open this page</h1>
    <p>Your saved work is still available. Try again, or return to your campaigns.</p>
    <div className="flex flex-wrap gap-3"><Button onClick={reset}>Try again</Button>
      <a className="btn btn-ghost" href="/campaigns">Return to campaigns</a></div>
  </div></div>;
}
