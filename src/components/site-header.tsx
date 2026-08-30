import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { LogoutLink } from "@/components/logout-link";
import { AdminMenu } from "@/components/admin-menu";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { isAccountBlocked } from "@/lib/blocked-account";
import { DEFAULT_COUNCIL_ID } from "@/lib/launch-config";

export async function SiteHeader() {
  const supabase = await createClient();
  const user = await getUser();

  let favoriteCouncil: { id: string; name: string } | null = null;
  let manager = false;
  let pendingRequestCount = 0;
  let canSearch = false;
  // Zablokowane konto ma ważną sesję, więc bez tego sprawdzenia dostawało
  // pełne menu — a każdy odsyłacz w nim odbijał się od bramki w proxy.
  const blocked = user ? await isAccountBlocked(supabase, user.id) : false;
  // Anonimowy nie ma ulubionej rady, ale RLS już wpuszcza go do jedynej
  // publicznej — pokazujemy tę samą nawigację co zalogowanemu z ulubioną,
  // tylko bez serca (to nie jest "ulubiona", to jedyna dostępna) i bez
  // Szukaj (canSearch zostaje false, wymaga zalogowania z vote).
  let anonCouncilName: string | null = null;
  if (!user) {
    const { data: council } = await supabase
      .from("council")
      .select("name")
      .eq("id", DEFAULT_COUNCIL_ID)
      .maybeSingle();
    anonCouncilName = council?.name ?? null;
  }
  if (user && !blocked) {
    const [{ data: appUser }, { data: isManager }, { data: hasVote }] =
      await Promise.all([
        supabase
          .from("app_user")
          .select("favorite_council:favorite_council_id(id, name)")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.rpc("is_manager", { uid: user.id }),
        // Szukaj to pole tekstowe — sam browse to za mało, patrz szukaj/page.tsx.
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "vote",
          target_council_id: DEFAULT_COUNCIL_ID,
        }),
      ]);
    favoriteCouncil = appUser?.favorite_council ?? null;
    manager = isManager ?? false;
    canSearch = hasVote ?? false;

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
        {!blocked && canSearch && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/szukaj"
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Szukaj
            </Link>
          </>
        )}
        {(() => {
          const navCouncil = favoriteCouncil
            ? { ...favoriteCouncil, isFavorite: true }
            : !user && anonCouncilName
              ? { id: DEFAULT_COUNCIL_ID, name: anonCouncilName, isFavorite: false }
              : null;
          if (!navCouncil || blocked) return null;
          return (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Link
                href={`/rada/${navCouncil.id}`}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {navCouncil.isFavorite ? `♥ ${navCouncil.name}` : navCouncil.name}
              </Link>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Link
                href={`/rada/${navCouncil.id}/radni`}
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
                href={`/rada/${navCouncil.id}/sesje`}
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Sesje
              </Link>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Link
                href={`/rada/${navCouncil.id}/glosy`}
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Głosy
              </Link>
            </>
          );
        })()}
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
          <GoogleSignInButton
            className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            label="Zaloguj"
          />
        )}
      </nav>
    </header>
  );
}
