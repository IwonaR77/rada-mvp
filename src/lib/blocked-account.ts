import type { createClient } from "@/lib/supabase/server";

/**
 * Czy zalogowane konto jest zablokowane (Regulamin §5.6).
 *
 * Nagłówek, stopka i strona `/brak-dostepu` pytają o to niezależnie od proxy:
 * sesja istnieje także przy blokadzie, więc sam fakt zalogowania nie może
 * decydować o tym, co pokazujemy w menu. Bez tego zablokowana osoba widziała
 * pełne menu, w którym każdy odsyłacz i tak odbijał się od bramki.
 *
 * Własny wiersz `app_user` każdy czyta na mocy polityki „user reads own
 * app_user", więc zapytanie działa nawet wtedy, gdy blokada odcina resztę
 * danych.
 *
 * @returns `true` tylko przy potwierdzonej blokadzie. Gdy wiersza nie da się
 *   odczytać, zwraca `false` — menu ma się wtedy zachować jak dotąd, a nie
 *   udawać blokady, której nie potwierdziliśmy.
 */
export async function isAccountBlocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("app_user")
    .select("blocked_at")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data?.blocked_at);
}
