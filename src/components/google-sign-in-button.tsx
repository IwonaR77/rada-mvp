"use client";

import { createClient } from "@/lib/supabase/client";

export function GoogleSignInButton() {
  const supabase = createClient();

  async function handleSignIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Supabase's hosted authorize redirect doesn't attach the apikey
        // header (it's a plain browser navigation), and projects using the
        // new publishable-key format require it explicitly. Kong also
        // accepts apikey as a query param, so pass it through here.
        queryParams: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
      },
    });
  }

  return (
    <button
      onClick={handleSignIn}
      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
    >
      Kontynuuj z Google
    </button>
  );
}
