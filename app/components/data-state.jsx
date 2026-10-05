"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DataState({ loading, error, empty, retry, children }) {
  if (loading) return <p role="status" className="muted">Loading your assessment…</p>;
  if (error) return <div className="card"><div role="alert" className="err">{error}</div><Button variant="outline" onClick={retry}>Try again</Button></div>;
  if (empty) return <div className="card"><h1>No campaigns yet</h1><p className="muted">Start with a campaign to collect stakeholder feedback. Results unlock once enough people have responded.</p><Link className="btn btn-primary" href="/campaigns">View campaigns</Link></div>;
  return children;
}
