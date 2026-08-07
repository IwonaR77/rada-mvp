import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const SEARCH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

// Pages reachable without a session — everything else requires login.
// Browsing itself now requires the auto-granted "browse" permission (see
// grant_browse_permission(), called from /auth/callback), enforced by RLS;
// this gate just keeps logged-out visitors from reaching pages that would
// otherwise render empty/broken instead of a proper login prompt.
const PUBLIC_PATHS = new Set(["/", "/auth/callback", "/auth/error", "/logout"]);

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

  const { response, user } = await updateSession(request);

  if (!user && !PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
