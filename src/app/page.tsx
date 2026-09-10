import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LogoutLink } from "@/components/logout-link";
import { DEFAULT_COUNCIL_ID } from "@/lib/launch-config";
import { isOwner } from "@/lib/site-lockdown";

// Serwis wstrzymany dla wszystkich poza właścicielką (zob.
// src/lib/site-lockdown.ts) — brak potwierdzonej zgody firmy obsługującej
// esesja.pl na przetwarzanie nagrań, z których serwis korzysta. proxy.ts
// odsyła tu każde inne żądanie. Układ (grafika + opis) jak na pierwotnej
// stronie powitalnej sprzed rozjazdu na /rada/[id] (patrz historia git tego
// pliku) — zmienił się tylko sam opis i to, że jedynym linkiem na stronie
// jest logowanie.
export default async function Home() {
  const user = await getUser();

  if (!user || !isOwner(user.email)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-12 bg-zinc-50 px-6 py-16 dark:bg-black lg:flex-row lg:gap-16">
        {/* Kolejność w DOM odwrócona względem układu na desktopie
            (`order-*`), żeby na telefonie tekst i przycisk logowania były
            widoczne bez przewijania, zamiast chować się pod dużą grafiką —
            to jedyna sprawcza rzecz na stronie, więc nie może wymagać
            scrollowania. */}
        <div className="order-2 w-full max-w-sm overflow-hidden rounded-2xl shadow-lg lg:order-1">
          <Image
            src="/homepage-hero.webp"
            alt="Pusta sala obrad rady"
            width={1024}
            height={1400}
            priority
            className="h-auto w-full object-cover"
          />
        </div>

        <div className="order-1 flex w-full max-w-md flex-col gap-6 lg:order-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Rada
            </h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              {user
                ? "Serwis jest naprawdę wyłączony. Nie masz tu czego szukać."
                : "Serwis wyłączony."}
            </p>
          </div>

          {!user ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <GoogleSignInButton />
            </div>
          ) : (
            // Zalogowany, ale niewłaściwym kontem (np. właścicielka trafiła
            // tu z sesją sprzed zmiany) — bez wylogowania nie da się
            // zalogować ponownie jako ktoś inny.
            <LogoutLink className="self-start text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100" />
          )}
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: appUser } = await supabase
    .from("app_user")
    .select("favorite_council_id")
    .eq("id", user.id)
    .maybeSingle();
  redirect(
    appUser?.favorite_council_id
      ? `/rada/${appUser.favorite_council_id}`
      : `/rada/${DEFAULT_COUNCIL_ID}`
  );
}
