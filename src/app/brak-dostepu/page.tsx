import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Konto zablokowane — Rada",
};

/**
 * Strona, na którą proxy kieruje zablokowane konto.
 *
 * Bez niej blokada wyglądała jak awaria: osoba logowała się normalnie i
 * trafiała na puste listy, bez śladu, dlaczego nic nie widzi.
 */
export default async function BrakDostepuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Własny wiersz app_user każdy czyta bez przeszkód (polityka
  // "user reads own app_user"), więc powód blokady da się pokazać osobie,
  // której dotyczy — a nie tylko managerom.
  const { data: me } = await supabase
    .from("app_user")
    .select("blocked_at, blocked_reason")
    .eq("id", user.id)
    .maybeSingle();

  // Konto odblokowane w międzyczasie — nie ma po co trzymać nikogo na tej
  // stronie tylko dlatego, że został na niej otwarty adres.
  //
  // Warunek celowo wymaga ODCZYTANEGO wiersza bez blokady, a nie po prostu
  // braku daty: gdyby zapytanie nic nie zwróciło, przekierowanie na "/"
  // odbiłoby się od bramki w proxy z powrotem tutaj i powstałaby pętla.
  if (me && !me.blocked_at) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Konto zablokowane
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Dostęp do treści Serwisu został zablokowany
        {me?.blocked_at
          ? ` ${new Date(me.blocked_at).toLocaleDateString("pl-PL")}`
          : ""}{" "}
        na podstawie §5.6 Regulaminu.
      </p>
      {me?.blocked_reason && (
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Powód
          </p>
          <p className="text-zinc-700 dark:text-zinc-300">
            {me.blocked_reason}
          </p>
        </div>
      )}
      <p className="text-zinc-600 dark:text-zinc-400">
        Samo konto nadal istnieje i możesz się zalogować, ale nie zobaczysz
        transkrypcji, spraw ani profili radnych. Jeśli uważasz, że to pomyłka,
        odpowiedz na wiadomość, którą dostałaś lub dostałeś, albo napisz do
        redakcji Serwisu.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/regulamin"
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Regulamin
        </Link>
        <Link
          href="/logout"
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Wyloguj się
        </Link>
      </div>
    </div>
  );
}
