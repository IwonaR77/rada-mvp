"use client";

import { createClient } from "@/lib/supabase/client";
import { broadcastSignedOut } from "@/components/auth-sync";

export function LogoutLink({ className }: { className?: string }) {
  return (
    <a
      href="/logout"
      className={className}
      onClick={async (e) => {
        e.preventDefault();
        // Sign out client-side first so the session cookie is already
        // cleared (and other tabs' refresh sees it) before they're notified.
        await createClient().auth.signOut();
        broadcastSignedOut();
        window.location.href = "/logout";
      }}
    >
      Wyloguj
    </a>
  );
}
