"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// SiteHeader lives in the root layout, which Next.js does not re-fetch on
// client-side navigation — so signing out in one tab leaves other open tabs
// showing the stale logged-in header until they hard-reload. This channel
// lets a sign-out in one tab tell every other tab to refresh.
const CHANNEL_NAME = "rada-auth";

export function AuthSync() {
  const router = useRouter();

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = () => router.refresh();
    return () => channel.close();
  }, [router]);

  return null;
}

export function broadcastSignedOut() {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage("signed-out");
  channel.close();
}
