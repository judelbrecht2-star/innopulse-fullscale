"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingCard } from "./parts";

/* /settings has no content of its own — Profile is the landing page. */
export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/profile"); }, [router]);
  return <LoadingCard />;
}
