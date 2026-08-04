import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let favoriteCouncil: { id: string; name: string } | null = null;
  let pendingRequestCount = 0;
  if (user) {
    const [{ data: appUser }, { data: isManager }] = await Promise.all([
      supabase
        .from("app_user")
        .select("favorite_council:favorite_council_id(id, name)")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.rpc("is_manager", { uid: user.id }),
    ]);
    favoriteCouncil = appUser?.favorite_council ?? null;

    if (isManager) {
      const { count } = await supabase
        .from("access_request")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      pendingRequestCount = count ?? 0;
    }
  }

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          Home
        </Link>
        {favoriteCouncil && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href={`/rada/${favoriteCouncil.id}`}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ♥ {favoriteCouncil.name}
            </Link>
          </>
        )}
      </div>

      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/sprawy"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Sprawy
        </Link>
        {user ? (
          <>
            {pendingRequestCount > 0 && (
              <Link
                href="/admin/dostep"
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Prośby o dostęp ({pendingRequestCount})
              </Link>
            )}
            <Link
              href="/dostep"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Dostęp
            </Link>
            <span className="hidden text-zinc-500 sm:inline">
              {user.email}
            </span>
            <a
              href="/logout"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Wyloguj
            </a>
          </>
        ) : (
          <Link
            href="/"
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Kontynuuj z Google
          </Link>
        )}
      </nav>
    </header>
  );
}
