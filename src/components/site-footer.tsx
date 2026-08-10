import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAccountBlocked } from "@/lib/blocked-account";

export async function SiteFooter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Prompty czyta się z dysku, nie z bazy, więc RLS ich nie chroni — dla
  // zablokowanego konta odsyłacze muszą zniknąć z menu, tak jak sama treść
  // znika za bramką w proxy.
  const blocked = user ? await isAccountBlocked(supabase, user.id) : false;

  return (
    <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href="/regulamin" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Regulamin
        </Link>
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
        <Link
          href="/polityka-prywatnosci"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Polityka Prywatności
        </Link>
        {user && !blocked && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/prompt-podsumowania"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Prompt (sesje)
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/prompt-oceny-radnych"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Prompt (radni)
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/prompt-spraw"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Prompt (sprawy)
            </Link>
          </>
        )}
      </div>
    </footer>
  );
}
