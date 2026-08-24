import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "./database.types";

// cache() memoizuje na czas jednego requestu RSC: layout (SiteHeader) i strona
// dostają ten sam klient i to samo `getUser()` bez ponownego zapytania.
// `getUser()` zawsze robi round-trip do serwera Auth (w odróżnieniu od
// `getSession()`, który tylko dekoduje ciasteczko) — bez tej pamięci każda
// strona płaciła ten koszt osobno, po kolei, mimo że w ramach requestu wynik
// się nie zmienia.
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — the proxy refreshes
            // the session, so this can be safely ignored.
          }
        },
      },
    }
  );
});

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
