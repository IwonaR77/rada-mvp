import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { DEFAULT_COUNCIL_ID } from "@/lib/launch-config";
import { isOwner } from "@/lib/site-lockdown";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

// Serwis wstrzymany dla wszystkich poza właścicielką (zob.
// src/lib/site-lockdown.ts) — brak potwierdzonej zgody firmy obsługującej
// esesja.pl na przetwarzanie nagrań, z których serwis korzysta. proxy.ts
// odsyła tu każde inne żądanie, więc "/" jest jedyną treścią, którą widzi
// ktoś inny niż właścicielka: bez żadnych innych linków poza logowaniem, bo
// stąd i tak nigdzie się nie da dalej przejść.
export default async function Home() {
  const user = await getUser();

  if (!user || !isOwner(user.email)) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Serwis jest wyłączony
        </h1>
        {user ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nie mamy jeszcze potwierdzonej zgody firmy obsługującej esesja.pl
            na przetwarzanie nagrań sesji, z których serwis korzysta.
          </p>
        ) : (
          <GoogleSignInButton
            className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
            label="Zaloguj"
          />
        )}
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
