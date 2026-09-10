import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { clientIp } from "@/lib/rate-limit";
import { isOwner } from "@/lib/site-lockdown";

const SEARCH_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

// Nie o pojedyncze żądanie chodzi, tylko o to, żeby masowe ściąganie
// otagowanych ręcznie danych (przypisania segmentów do mówców, sprawy —
// to jest faktyczna praca redakcji, nie tylko jawny zapis sesji) kosztowało
// więcej niż jest warte. Próg celowo szeroki: człowiek klikający po stronie
// normalnie nigdy go nie dotknie, bot ściągający wszystko po kolei — tak.
const GENERAL_RATE_LIMIT = { limit: 300, windowSeconds: 300 };

// Serwis wstrzymany dla wszystkich poza właścicielką (zob. site-lockdown.ts).
// Te ścieżki muszą działać, zanim w ogóle wiadomo, kto pyta: sama strona
// główna (dla kogoś innego niż właścicielka pokazuje informację o
// wyłączeniu zamiast normalnej treści — patrz src/app/page.tsx) i cały
// przepływ logowania/wylogowania.
const ALWAYS_ALLOWED_PATHS = new Set([
  "/",
  "/auth/callback",
  "/auth/error",
  "/logout",
  // Regulamin i polityka prywatności zostają publiczne niezależnie od
  // wyłączenia — to nie jest treść serwisu, tylko dokumenty, na które ktoś
  // (np. już zalogowany współpracownik) może chcieć się powołać.
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
  const { response, user, rateLimitResults } = await updateSession(
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

  if (
    !ALWAYS_ALLOWED_PATHS.has(request.nextUrl.pathname) &&
    !isOwner(user?.email)
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
