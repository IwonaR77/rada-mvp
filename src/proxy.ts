import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { clientIp } from "@/lib/rate-limit";

const SEARCH_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

// Nie o pojedyncze żądanie chodzi, tylko o to, żeby masowe ściąganie
// otagowanych ręcznie danych (przypisania segmentów do mówców, sprawy —
// to jest faktyczna praca redakcji, nie tylko jawny zapis sesji) kosztowało
// więcej niż jest warte. Próg celowo szeroki: człowiek klikający po stronie
// normalnie nigdy go nie dotknie, bot ściągający wszystko po kolei — tak.
const GENERAL_RATE_LIMIT = { limit: 300, windowSeconds: 300 };

// Pages reachable without a session — everything else requires login.
// Browsing itself now requires the auto-granted "browse" permission (see
// grant_browse_permission(), called from /auth/callback), enforced by RLS;
// this gate just keeps logged-out visitors from reaching pages that would
// otherwise render empty/broken instead of a proper login prompt.
const PUBLIC_PATHS = new Set([
  "/",
  "/auth/callback",
  "/auth/error",
  "/logout",
  "/regulamin",
  "/polityka-prywatnosci",
]);

// Ścieżki, które widzi także zablokowane konto (Regulamin §5.6). Regulamin i
// polityka zostają celowo: są publiczne dla niezalogowanych, więc odcinanie
// ich zablokowanym niczego nie chroni, a utrudnia sprawdzenie, na jakiej
// podstawie blokada nastąpiła.
const BLOCKED_ALLOWED_PATHS = new Set([
  "/brak-dostepu",
  "/logout",
  "/auth/callback",
  "/auth/error",
  "/regulamin",
  "/polityka-prywatnosci",
]);

export async function proxy(request: NextRequest) {
  const ip = clientIp(request.headers);
  const isSzukaj = request.nextUrl.pathname === "/szukaj";

  // Trwały (Postgres) licznik, nie w pamięci procesu — na Vercelu każde
  // żądanie może trafić na inną instancję funkcji, więc licznik w pamięci
  // liczyłby osobno na każdej i limit by realnie nie działał. Patrz
  // `checkRateLimitDurable` w `src/lib/rate-limit.ts`. Liczone równolegle
  // z odświeżeniem sesji (`updateSession`), bo żadne z nich nie zależy od
  // wyniku drugiego.
  const { response, user, supabase, rateLimitResults } = await updateSession(
    request,
    [
      { key: `ogolny:${ip}`, config: GENERAL_RATE_LIMIT },
      ...(isSzukaj
        ? [{ key: `szukaj:${ip}`, config: SEARCH_RATE_LIMIT }]
        : []),
    ]
  );
  const [general, search] = rateLimitResults;

  if (!general.allowed) {
    return new NextResponse(
      "Zbyt wiele żądań w krótkim czasie. Spróbuj ponownie za chwilę.",
      {
        status: 429,
        headers: { "Retry-After": String(general.retryAfterSeconds) },
      }
    );
  }

  if (isSzukaj && search && !search.allowed) {
    return new NextResponse(
      "Zbyt wiele wyszukiwań w krótkim czasie. Spróbuj ponownie za chwilę.",
      {
        status: 429,
        headers: { "Retry-After": String(search.retryAfterSeconds) },
      }
    );
  }

  if (!user && !PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Blokada musi być egzekwowana tutaj, a nie tylko przez RLS. RLS pilnuje
  // danych, ale część stron nie czyta z bazy w ogóle — prompty i dokumenty
  // czytają z dysku, a /dostep pozwalał zablokowanemu kontu wnioskować
  // o nowe uprawnienia. Proxy jest jedynym miejscem, przez które przechodzi
  // każde żądanie, więc tu jest granica.
  //
  // Kosztuje jedno zapytanie po kluczu głównym na żądanie zalogowanego
  // użytkownika. Świadomy wybór: sesja nie niesie tej informacji, a blokada
  // musi działać od razu, nie po wygaśnięciu tokenu.
  if (user && !BLOCKED_ALLOWED_PATHS.has(request.nextUrl.pathname)) {
    const { data: account } = await supabase
      .from("app_user")
      .select("blocked_at")
      .eq("id", user.id)
      .maybeSingle();
    if (account?.blocked_at) {
      return NextResponse.redirect(new URL("/brak-dostepu", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
