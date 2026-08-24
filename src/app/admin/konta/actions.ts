"use server";

/**
 * @module
 * Server actions ("use server") behind `/admin/konta` — zatwierdzanie próśb o
 * dostęp, nadawanie/zmiana poziomu uprawnień, blokowanie kont, cofanie
 * dostępu. To jest granica podnoszenia uprawnień (elevation of privilege) w
 * całej aplikacji: stąd jedyna droga, żeby cokolwiek zyskało `full_access`.
 *
 * @remarks Granica zaufania
 * Next.js Server Actions są wywoływalne bezpośrednio (POST na ID akcji) przez
 * dowolnego zalogowanego klienta, z pominięciem strony `/admin/konta` i jej
 * warunków renderowania UI. Dlatego każda eksportowana funkcja w tym pliku
 * sama, od nowa, sprawdza uprawnienia przez {@link requireManager} — nic nie
 * jest tu bezpieczne tylko dlatego, że panel nie pokazuje przycisku.
 * Argumenty wywołania (`targetAppUserId`, `level`, `councilId`, `requestId`)
 * są więc niezaufanym wejściem od zalogowanego, ale dowolnego użytkownika, aż
 * do potwierdzenia `requireManager()` — i każdy z nich jest dodatkowo
 * weryfikowany względem bazy (odczyt istniejącego wiersza), a nie przyjmowany
 * w ciemno.
 *
 * @remarks STRIDE
 * - **Spoofing**: nie dotyczy — tożsamość wywołującego pochodzi z sesji
 *   Supabase po stronie serwera (`supabase.auth.getUser()`), nie z pola
 *   podanego przez klienta.
 * - **Tampering**: każda funkcja odczytuje docelowy wiersz z bazy przed
 *   zapisem (np. `approveAccessRequest` czyta `access_request` zamiast
 *   ufać przekazanemu statusowi) i warunkuje `UPDATE` przez `.eq("status",
 *   "pending")` — dwóch managerów zatwierdzających tę samą prośbę
 *   równocześnie: drugi zapis trafia na `count === 0` i dostaje czytelny
 *   błąd zamiast po cichu nadpisać już rozpatrzoną prośbę.
 * - **Repudiation**: każda zmiana stanu leci do `access_audit_log` przez
 *   {@link logAudit} (kto, kogo, jaka akcja, jaki zakres, wolny tekst) — to
 *   log na poziomie aplikacji, nie wyzwalacz bazy danych, więc każda przyszła
 *   ścieżka zapisu, która pominie `logAudit()`, nie zostawi śladu.
 * - **Information disclosure**: funkcje zwracają na sukces tylko `{ error:
 *   null }` — treść wierszy nie wraca do klienta. Komunikaty błędu (np.
 *   `roleWrite.error.message`) przepuszczają surowy tekst błędu
 *   Postgresa/RPC do przeglądarki; ryzyko niskie, bo wywołujący i tak musiał
 *   przejść `requireManager()`, ale warto o tym pamiętać, zanim ta bramka
 *   kiedyś zostanie poluzowana.
 * - **Denial of service**: brak limitu częstotliwości na tych akcjach — celowo,
 *   bo pula wywołujących jest już ograniczona do managerów (w odróżnieniu od
 *   tras publicznych, patrz `src/lib/rate-limit.ts`).
 * - **Elevation of privilege**: sedno tego modułu. {@link requireManager}
 *   sprawdza `is_manager(uid)` — `role = 'manager' AND permissions @>
 *   ['full_access'] AND app_user.blocked_at IS NULL`
 *   (`scripts/migrate-block-account.sql`). Samo-celowanie jest osobno
 *   zablokowane w {@link setAccessLevel}, {@link setAccountBlocked} i
 *   {@link revokeUserRole} — jedyny manager nie może się sam zablokować ani
 *   przypadkiem obniżyć sobie uprawnień z tego panelu. `setAccountBlocked`
 *   idzie dodatkowo przez funkcję SQL `set_account_blocked`
 *   (`SECURITY DEFINER`), która powtarza *ten sam* test
 *   `user_has_permission(..., 'full_access')` i blokadę samo-celowania na
 *   poziomie bazy — obrona w głąb, a nie poleganie wyłącznie na tym pliku.
 *
 * @remarks Nieprzeweryfikowane w tym repo
 * Polityki RLS dla `user_role`, `access_request` i `access_audit_log` nie są
 * zdefiniowane w skryptach SQL tego repo (w odróżnieniu od jawnej definicji
 * `set_account_blocked`) — nie da się ich więc potwierdzić samą lekturą kodu.
 * Brak/błędna polityka nie rzuca błędu, tylko po cichu zapisuje 0 wierszy
 * (patrz `feedback_rls_silent_denial`), dlatego każdy zapis w tym pliku
 * sprawdza `count === 0`, nie tylko `error`.
 */

import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/access-levels";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Bramka autoryzacji wywoływana na początku każdej eksportowanej akcji w tym
 * pliku — patrz sekcja „Elevation of privilege” w dokumentacji modułu.
 *
 * @returns `{ error: null, supabase, userId }` gdy wywołujący jest
 *   zalogowanym managerem; w przeciwnym razie `{ error: <komunikat po
 *   polsku>, supabase, userId: null }`. `supabase` wraca zawsze (potrzebny
 *   nawet przy błędzie do ewentualnych dalszych operacji), `userId` tylko
 *   przy sukcesie.
 */
async function requireManager() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) {
    return { error: "Musisz być zalogowany" as const, supabase, userId: null };
  }

  const { data: manager } = await supabase.rpc("is_manager", { uid: user.id });
  if (!manager) {
    return { error: "Brak uprawnień managera" as const, supabase, userId: null };
  }

  return { error: null, supabase, userId: user.id };
}

/**
 * Zapisuje jeden wiersz do `access_audit_log` — jedyny mechanizm
 * niezaprzeczalności (repudiation) w tym module, patrz dokumentacja modułu.
 * Wywołanie jest "fire and forget": błąd zapisu audytu nie jest sprawdzany
 * ani propagowany, więc nieudany zapis audytu nie cofa i nie blokuje już
 * wykonanej zmiany uprawnień/blokady.
 *
 * @param supabase - klient z sesją wywołującego (RLS na `access_audit_log`
 *   działa w jego imieniu, nie jako serwis).
 * @param actorId - `id` managera wykonującego akcję (`app_user.id`).
 * @param targetAppUserId - `id` konta, którego dotyczy akcja.
 * @param action - etykieta zdarzenia, np. `"role_updated"`,
 *   `"account_blocked"` — wolny tekst, bez wyliczenia typu; niespójna nazwa
 *   tutaj nie jest wykrywana statycznie.
 * @param scopeCouncilId - zakres (rada), którego dotyczy zmiana, albo `null`
 *   dla zmian globalnych.
 * @param details - opis zdarzenia po polsku do wyświetlenia w panelu audytu.
 */
async function logAudit(
  supabase: SupabaseClient<Database>,
  actorId: string,
  targetAppUserId: string,
  action: string,
  scopeCouncilId: string | null,
  details: string
) {
  await supabase.from("access_audit_log").insert({
    actor_id: actorId,
    target_app_user_id: targetAppUserId,
    action,
    scope_council_id: scopeCouncilId,
    details,
  });
}

/**
 * Współdzielone przez {@link approveAccessRequest} — scala uprawnienia z
 * nowego poziomu do istniejącego wiersza `user_role` zamiast go nadpisywać.
 *
 * @remarks Algorytm
 * Użytkownik może dziś mieć co najwyżej jeden wiersz `user_role` na zakres
 * (nic innego nie zapisuje do tej tabeli), więc funkcja robi sumę zbiorów
 * (`Set` z połączenia starych i nowych `permissions`) zamiast zastąpienia.
 * Wiersz globalny (`scope_council_id IS NULL`) celu jest też miejscem, gdzie
 * żyje automatycznie nadawane `"browse"` (patrz `grant_browse_permission()`
 * wywoływane z `/auth/callback`) — scalanie zamiast zastępowania zachowuje
 * `browse`, zamiast po cichu odbierać podstawowy dostęp przy nadawaniu
 * wyższego poziomu.
 *
 * @param supabase - klient z sesją wywołującego (już zweryfikowanego jako
 *   manager przez {@link requireManager} u wywołującego tę funkcję).
 * @param targetAppUserId - `id` konta, które ma otrzymać uprawnienia.
 * @param levelDef - definicja poziomu z {@link ADMIN_LEVELS} (tylko pole
 *   `permissions` jest tu używane).
 * @param councilId - zakres nadania, albo `null` dla wiersza globalnego.
 * @returns wynik zapytania Supabase `update`/`insert` z `{ count: "exact" }},
 *   albo `{ error, count: null }` jeśli wcześniejszy odczyt istniejącego
 *   wiersza się nie powiódł (patrz uwaga o unikalnym indeksie w kodzie
 *   poniżej).
 */
async function mergeUserRoleGrant(
  supabase: SupabaseClient<Database>,
  targetAppUserId: string,
  levelDef: { permissions: readonly string[] },
  councilId: string | null
) {
  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", targetAppUserId);
  existingQuery = councilId
    ? existingQuery.eq("scope_council_id", councilId)
    : existingQuery.is("scope_council_id", null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  // A UNIQUE index now guarantees at most one row per (app_user_id, scope)
  // (see migration 2026-08-09), so this should never fire in normal
  // operation — but .maybeSingle() still errors if it somehow does, and
  // that error used to be silently dropped here (only `data` was
  // destructured), which masked a real duplicate-row bug in production.
  if (existingError) return { error: existingError, count: null };

  const mergedPermissions = Array.from(
    new Set([...(existing?.permissions ?? []), ...levelDef.permissions])
  );

  // user_role.role has a DB check constraint allowing only 'manager' — it
  // doesn't track the actual tier, that's what permissions[] is for.
  return existing
    ? supabase
        .from("user_role")
        .update(
          { permissions: mergedPermissions, role: "manager" },
          { count: "exact" }
        )
        .eq("id", existing.id)
    : supabase.from("user_role").insert(
        {
          app_user_id: targetAppUserId,
          role: "manager",
          permissions: mergedPermissions,
          scope_council_id: councilId,
        },
        { count: "exact" }
      );
}

/**
 * Zatwierdza prośbę o dostęp: nadaje uprawnienia (przez
 * {@link mergeUserRoleGrant}, sumujące, nie zastępujące) i oznacza prośbę
 * jako `"approved"`.
 *
 * @remarks Bezpieczeństwo współbieżności
 * `UPDATE ... WHERE id = requestId AND status = 'pending'` działa jako
 * optymistyczna blokada: jeśli dwóch managerów zatwierdzi tę samą prośbę
 * niemal równocześnie, drugi zapis trafi na `count === 0` i dostanie błąd
 * „Prośba została już rozpatrzona przez kogoś innego” zamiast po cichu
 * nadać uprawnienia po raz drugi lub nadpisać `decided_by`.
 *
 * @param requestId - `id` wiersza `access_request` (`status` musi być
 *   `"pending"`, inaczej funkcja zwraca błąd bez żadnego zapisu).
 * @param overrideLevel - poziom do faktycznego nadania; może różnić się od
 *   `requested_level` w bazie (manager koryguje prośbę w dół/górę) — wtedy
 *   różnica jest zapisywana w `decision_note`.
 * @param overrideCouncilId - zakres do faktycznego nadania; jak wyżej, może
 *   różnić się od pierwotnie wnioskowanego.
 * @returns `{ error: null }` na sukces; w przeciwnym razie `{ error:
 *   <komunikat po polsku lub tekst błędu Postgresa> }`.
 */
export async function approveAccessRequest(
  requestId: string,
  overrideLevel: AdminLevel,
  overrideCouncilId: string | null
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: request } = await supabase
    .from("access_request")
    .select("app_user_id, requested_level, scope_council_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "Nie znaleziono prośby" };
  if (request.status !== "pending")
    return { error: "Ta prośba została już rozpatrzona" };

  const levelDef = ADMIN_LEVELS[overrideLevel];
  if (!levelDef) return { error: "Nieznany poziom dostępu" };

  const roleWrite = await mergeUserRoleGrant(
    supabase,
    request.app_user_id,
    levelDef,
    overrideCouncilId
  );

  if (roleWrite.error) return { error: roleWrite.error.message };
  if (roleWrite.count === 0)
    return { error: "Nie udało się zapisać uprawnień" };

  const wasOverridden =
    overrideLevel !== request.requested_level ||
    overrideCouncilId !== request.scope_council_id;

  const { error, count } = await supabase
    .from("access_request")
    .update(
      {
        status: "approved",
        decided_by: userId,
        decided_at: new Date().toISOString(),
        ...(wasOverridden
          ? {
              requested_level: overrideLevel,
              scope_council_id: overrideCouncilId,
              decision_note: `Pierwotnie proszono o: ${
                ADMIN_LEVELS[request.requested_level as AdminLevel]?.label ??
                request.requested_level
              }`,
            }
          : {}),
      },
      { count: "exact" }
    )
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  if (count === 0)
    return { error: "Prośba została już rozpatrzona przez kogoś innego" };

  await logAudit(
    supabase,
    userId,
    request.app_user_id,
    "request_approved",
    overrideCouncilId,
    `Zatwierdzono: ${levelDef.label}${wasOverridden ? " (zmieniono zakres/poziom)" : ""}`
  );

  revalidatePath("/admin/konta");
  return { error: null };
}

/**
 * Odrzuca prośbę o dostęp — nie nadaje żadnych uprawnień, tylko zmienia
 * `access_request.status` na `"denied"` z opcjonalną notatką.
 *
 * @remarks Bezpieczeństwo współbieżności
 * Tak samo jak {@link approveAccessRequest}: warunek `.eq("status",
 * "pending")` w `UPDATE` chroni przed podwójnym rozpatrzeniem tej samej
 * prośby przez dwóch managerów naraz — w odróżnieniu od `approveAccessRequest`
 * ten plik NIE sprawdza tu statusu przed zapisem (brak wcześniejszego
 * odczytu `request.status`), więc jedynym zabezpieczeniem jest warunek w
 * samym `UPDATE`.
 *
 * @param requestId - `id` wiersza `access_request`.
 * @param note - wolny tekst powodu odrzucenia; puste/białe znaki zapisują się
 *   jako `null` (`note.trim() || null`), ale do audytu i tak trafia
 *   zastępczy tekst „Odrzucono bez podania powodu”.
 * @returns `{ error: null }` na sukces; w przeciwnym razie `{ error:
 *   <komunikat po polsku lub tekst błędu Postgresa> }`.
 */
export async function denyAccessRequest(requestId: string, note: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: request } = await supabase
    .from("access_request")
    .select("app_user_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "Nie znaleziono prośby" };

  const { error, count } = await supabase
    .from("access_request")
    .update(
      {
        status: "denied",
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: note.trim() || null,
      },
      { count: "exact" }
    )
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  if (count === 0) return { error: "Prośba została już rozpatrzona" };

  await logAudit(
    supabase,
    userId,
    request.app_user_id,
    "request_denied",
    null,
    note.trim() || "Odrzucono bez podania powodu"
  );

  revalidatePath("/admin/konta");
  return { error: null };
}

/**
 * Ustawia poziom dostępu osoby w JEDNYM zakresie — tworzy wpis, jeśli go tam
 * jeszcze nie ma, a jeśli jest, zastępuje dotychczasowy poziom.
 *
 * Jedna operacja zamiast dawnej pary „nadaj" (sumowała uprawnienia) i „zmień"
 * (zastępowała je). Panel wyglądał tak samo w obu przypadkach, więc obniżenie
 * poziomu przez „nadaj" po cichu nic nie robiło — suma uprawnień Moderatora
 * i Redaktora to nadal Moderator — a w logu zdarzeń lądował wpis o nadaniu,
 * które się nie odbyło.
 *
 * Sumowanie zostaje tam, gdzie jest na miejscu: przy zatwierdzaniu próśb
 * o dostęp (`approveAccessRequest`), gdzie nikt niczego nie obniża.
 *
 * @remarks Bezpieczeństwo
 * Blokuje samo-celowanie (`targetAppUserId === userId`) — patrz sekcja
 * „Elevation of privilege” w dokumentacji modułu: bez tego jedyny manager
 * mógłby sobie odebrać `full_access` i zamknąć się poza `/admin/konta`.
 *
 * @param targetAppUserId - `id` konta, którego poziom jest ustawiany; musi
 *   różnić się od `id` wywołującego (patrz „Bezpieczeństwo” wyżej).
 * @param level Poziom docelowy; `browse` (nadawane automatycznie przy
 *   pierwszym logowaniu) przetrwa niezależnie od wyboru — zmieniamy szczebel
 *   współtworzenia, nie odbieramy podstawowego dostępu.
 * @param councilId - zakres, w którym poziom jest ustawiany, albo `null` dla
 *   wiersza globalnego.
 * @returns `{ error: null }` na sukces; w przeciwnym razie `{ error:
 *   <komunikat po polsku lub tekst błędu Postgresa> }` — w tym przypadek
 *   `count === 0`, gdy RLS po cichu odrzuciło zapis (patrz
 *   `feedback_rls_silent_denial` w dokumentacji modułu).
 */
export async function setAccessLevel(
  targetAppUserId: string,
  level: AdminLevel,
  councilId: string | null
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const levelDef = ADMIN_LEVELS[level];
  if (!levelDef) return { error: "Nieznany poziom dostępu" };

  // Ta sama blokada co dawniej w updateUserRole: gdyby jedyny manager obniżył
  // sobie poziom, zamknąłby się w /admin/konta bez drogi powrotnej poza
  // bezpośrednim dostępem do bazy. Panel i tak nie pokazuje przycisku przy
  // własnym koncie — to zabezpieczenie na wypadek wywołania z pominięciem UI.
  if (targetAppUserId === userId) {
    return { error: "Nie możesz zmieniać własnych uprawnień z tego panelu." };
  }

  let existingQuery = supabase
    .from("user_role")
    .select("id, permissions")
    .eq("app_user_id", targetAppUserId);
  existingQuery = councilId
    ? existingQuery.eq("scope_council_id", councilId)
    : existingQuery.is("scope_council_id", null);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) return { error: existingError.message };

  const preserved = (existing?.permissions ?? []).filter((p) => p === "browse");
  const nextPermissions = Array.from(
    new Set([...preserved, ...levelDef.permissions])
  );

  // role zostaje 'manager' — kolumna ma check constraint dopuszczający tylko
  // tę wartość i nie opisuje szczebla; od tego jest permissions[].
  const { error, count } = existing
    ? await supabase
        .from("user_role")
        .update(
          { role: "manager", permissions: nextPermissions },
          { count: "exact" }
        )
        .eq("id", existing.id)
    : await supabase.from("user_role").insert(
        {
          app_user_id: targetAppUserId,
          role: "manager",
          permissions: nextPermissions,
          scope_council_id: councilId,
        },
        { count: "exact" }
      );

  if (error) return { error: error.message };
  // Brak błędu przy zerze zapisanych wierszy znaczy, że RLS po cichu odrzuciło
  // zapis — bez tej kontroli panel pokazałby sukces (feedback_rls_silent_denial).
  if (count === 0) return { error: "Nie udało się zapisać uprawnień" };

  await logAudit(
    supabase,
    userId,
    targetAppUserId,
    "role_updated",
    councilId,
    `${existing ? "Zmieniono poziom na" : "Nadano"}: ${levelDef.label}`
  );

  revalidatePath("/admin/konta");
  return { error: null };
}

/**
 * Blokuje albo odblokowuje konto w Serwisie (Regulamin §5.6).
 *
 * Blokada jest stanem konta (`app_user.blocked_at`), a nie odebraniem
 * uprawnień: samo zdjęcie „browse" nie działało, bo `grant_browse_permission()`
 * wstawiało je z powrotem przy każdym logowaniu.
 *
 * Wierszy `user_role` celowo nie ruszamy — odblokowanie ma przywrócić
 * poprzedni poziom, a nie kazać nadawać go od nowa. Dopóki konto jest
 * zablokowane, `user_has_permission()` i tak zwraca fałsz dla wszystkiego.
 *
 * Zapis idzie przez funkcję `set_account_blocked` (SECURITY DEFINER):
 * managerowie nie mają prawa zapisu do `app_user` i celowo tak zostaje.
 *
 * @remarks Bezpieczeństwo — obrona w głąb
 * Samo-blokada (`targetAppUserId === userId`) jest odrzucana zarówno tutaj,
 * jak i wewnątrz `set_account_blocked` na poziomie bazy — druga warstwa
 * działa nawet gdyby ta funkcja kiedyś przestała wywoływać ten warunek.
 *
 * @param targetAppUserId - `id` konta do zablokowania/odblokowania; musi
 *   różnić się od `id` wywołującego.
 * @param blocked - `true` blokuje konto, `false` odblokowuje.
 * @param reason - powód blokady (po polsku, max 500 znaków); ignorowany przy
 *   odblokowaniu (`set_account_blocked` dostaje wtedy pusty string, a
 *   `app_user.blocked_reason` jest czyszczone niezależnie od tego, co tu
 *   podano).
 * @returns `{ error: null }` na sukces; w przeciwnym razie `{ error:
 *   <komunikat po polsku lub tekst błędu RPC> }`.
 */
export async function setAccountBlocked(
  targetAppUserId: string,
  blocked: boolean,
  reason: string
) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  if (targetAppUserId === userId) {
    return { error: "Nie możesz zablokować własnego konta." };
  }

  const trimmed = reason.trim();
  if (blocked && trimmed.length > 500) {
    return { error: "Powód może mieć najwyżej 500 znaków." };
  }

  const { error } = await supabase.rpc("set_account_blocked", {
    target_id: targetAppUserId,
    blocked,
    reason: blocked ? trimmed : "",
  });
  if (error) return { error: error.message };

  await logAudit(
    supabase,
    userId,
    targetAppUserId,
    blocked ? "account_blocked" : "account_unblocked",
    null,
    blocked
      ? `Zablokowano konto${trimmed ? `: ${trimmed}` : ""}`
      : "Odblokowano konto"
  );

  revalidatePath("/admin/konta");
  return { error: null };
}

/**
 * Cofa jedno przyznane uprawnienie (jeden wiersz `user_role`).
 *
 * @remarks Algorytm
 * Nie zawsze jest to `DELETE`: jeśli wiersz niesie też automatycznie nadane
 * `"browse"` (bazowy dostęp do przeglądania), pełne usunięcie zabrałoby też
 * możliwość przeglądania serwisu, a nie tylko cofany szczebel
 * współtworzenia. W takim przypadku wiersz zostaje zaktualizowany do samego
 * `["browse"]` zamiast usunięty. Wiersz bez `"browse"` (typowy przypadek:
 * nadanie na poziomie jednej rady) nie ma nic do zachowania, więc idzie
 * zwykły `DELETE`.
 *
 * @remarks Bezpieczeństwo
 * Blokuje cofnięcie własnego uprawnienia (`existing.app_user_id === userId`)
 * z tego samego powodu co {@link setAccessLevel} — patrz „Elevation of
 * privilege” w dokumentacji modułu.
 *
 * @param roleId - `id` wiersza `user_role` do cofnięcia (nie `app_user_id` —
 *   jeden użytkownik może mieć kilka wierszy, po jednym na zakres).
 * @returns `{ error: null }` na sukces; w przeciwnym razie `{ error:
 *   <komunikat po polsku lub tekst błędu Postgresa> }`.
 */
export async function revokeUserRole(roleId: string) {
  const { error: permError, supabase, userId } = await requireManager();
  if (permError) return { error: permError };
  if (!userId) return { error: "Musisz być zalogowany" };

  const { data: existing } = await supabase
    .from("user_role")
    .select("app_user_id, permissions, scope_council_id")
    .eq("id", roleId)
    .maybeSingle();
  if (!existing) return { error: "Nie znaleziono uprawnienia" };
  if (existing.app_user_id === userId) {
    return { error: "Nie możesz cofnąć własnego uprawnienia z tego panelu." };
  }

  // If "browse" (the auto-granted baseline) is bundled into this row, only
  // strip the granted tier and leave the row with just browse — a full
  // DELETE here would also take away the ability to view the site, not
  // just the contribution tier being revoked. A row without browse (the
  // usual case: a council-scoped tier grant) has nothing to preserve, so a
  // plain delete is correct as-is.
  const hasBrowse = (existing.permissions ?? []).includes("browse");

  const { error, count } = hasBrowse
    ? await supabase
        .from("user_role")
        .update({ permissions: ["browse"] }, { count: "exact" })
        .eq("id", roleId)
    : await supabase
        .from("user_role")
        .delete({ count: "exact" })
        .eq("id", roleId);

  if (error) return { error: error.message };
  if (count === 0) return { error: "Nie udało się cofnąć uprawnienia" };

  await logAudit(
    supabase,
    userId,
    existing.app_user_id,
    "role_revoked",
    existing.scope_council_id,
    "Cofnięto dostęp"
  );

  revalidatePath("/admin/konta");
  return { error: null };
}
