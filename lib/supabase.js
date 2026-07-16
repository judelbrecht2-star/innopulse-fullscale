"use client";
import { createClient } from "@supabase/supabase-js";

// Public client credentials (anon key is designed to be public; all data access
// is enforced by row-level security in Postgres).
export const SUPABASE_URL = "https://jydbinexjckfzjqgsmjf.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5ZGJpbmV4amNrZnpqcWdzbWpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDk5NzYsImV4cCI6MjA5NzM4NTk3Nn0.B_CyTBOvpPaEcnu2mnTfwKFHtAv719IBaV0EyjeO6us";
export const FN_BASE = SUPABASE_URL + "/functions/v1";

let _sb = null;
export function sb() {
  if (!_sb) _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}
