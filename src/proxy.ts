import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const SEARCH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

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
  if (request.nextUrl.pathname === "/szukaj") {
    const key = `szukaj:${clientIp(request.headers)}`;
    const { allowed, retryAfterSeconds } = checkRateLimit(
      key,
      SEARCH_RATE_LIMIT
    );
    if (!allowed) {
      return new NextResponse(
        "Zbyt wiele wyszukiwań w krótkim czasie. Spróbuj ponownie za chwilę.",
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        }
      );
    }
  }

  const { response, user, supabase } = await updateSession(request);

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
