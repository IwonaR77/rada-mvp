import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  checkRateLimitDurable,
  type RateLimitConfig,
  type RateLimitResult,
} from "@/lib/rate-limit";

export async function updateSession(
  request: NextRequest,
  rateLimits: { key: string; config: RateLimitConfig }[]
) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() (odświeża token, wymagane bo Server Components nie mogą same
  // zapisywać ciasteczek) i liczniki rate-limitu nie zależą od siebie — dawniej
  // szły po kolei, co na KAŻDE żądanie dokładało zbędny sekwencyjny round-trip
  // do Postgresa jeszcze przed renderem strony.
  const [
    {
      data: { user },
    },
    rateLimitResults,
  ] = await Promise.all([
    supabase.auth.getUser(),
    Promise.all(
      rateLimits.map(({ key, config }) =>
        checkRateLimitDurable(supabase, key, config)
      )
    ),
  ]);

  // Klient wraca razem z sesją, żeby proxy mogło dopytać o stan konta bez
  // budowania drugiego klienta i drugiego odświeżenia tokenu.
  return { response, user, supabase, rateLimitResults };
}

export type { RateLimitResult };
