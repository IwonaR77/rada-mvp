import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const SEARCH_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

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

  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
