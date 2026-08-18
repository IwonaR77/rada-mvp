import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutLink } from "@/components/logout-link";
import { AdminMenu } from "@/components/admin-menu";
import { isAccountBlocked } from "@/lib/blocked-account";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let favoriteCouncil: { id: string; name: string } | null = null;
  let manager = false;
  let pendingRequestCount = 0;
  // Zablokowane konto ma ważną sesję, więc bez tego sprawdzenia dostawało
  // pełne menu — a każdy odsyłacz w nim odbijał się od bramki w proxy.
  const blocked = user ? await isAccountBlocked(supabase, user.id) : false;
  if (user && !blocked) {
    const [{ data: appUser }, { data: isManager }] = await Promise.all([
      supabase
        .from("app_user")
        .select("favorite_council:favorite_council_id(id, name)")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.rpc("is_manager", { uid: user.id }),
    ]);
    favoriteCouncil = appUser?.favorite_council ?? null;
    manager = isManager ?? false;

    if (manager) {
      const { count } = await supabase
        .from("access_request")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      pendingRequestCount = count ?? 0;
    }
  }

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
      <div className="flex items-center gap-3 text-sm">
        <Link
          href={blocked ? "/brak-dostepu" : "/"}
          className="font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          Home
        </Link>
        {favoriteCouncil && !blocked && (
          <>
            {/* Dla kogoś z ulubioną radą "Home" prowadzi już do niej, nie na
                mapę — bez tego wejścia mapa zostałaby bez żadnego linku. Komu
                ulubiona nie jest ustawiona, temu mapę daje samo "Home". */}
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/mapa"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Mapa
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href={`/rada/${favoriteCouncil.id}`}
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ♥ {favoriteCouncil.name}
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href={`/rada/${favoriteCouncil.id}/radni`}
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Radni
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/sprawy"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sprawy
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href={`/rada/${favoriteCouncil.id}/sesje`}
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sesje
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href={`/rada/${favoriteCouncil.id}/glosy`}
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Głosy
            </Link>
          </>
        )}
      </div>

      <nav className="flex items-center gap-4 text-sm">
        {user ? (
          <>
            <span className="hidden text-zinc-500 sm:inline">
              {user.email}
            </span>
            {blocked && (
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                konto zablokowane
              </span>
            )}
            {manager && <AdminMenu pendingRequestCount={pendingRequestCount} />}
            {/* Wnioskowanie o uprawnienia jest dla zablokowanego konta
                bez sensu — akcja i tak je odrzuci. */}
            {!blocked && (
              <Link
                href="/dostep"
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Uprawnienia
              </Link>
            )}
            <LogoutLink className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100" />
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
