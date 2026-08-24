// In-memory fixed-window rate limiter, keyed per caller (e.g. IP).
//
// Lives in module scope so it survives across requests within one Node.js
// process — Proxy defaults to the Node.js runtime as of Next.js 16, so this
// works as a single shared counter for a self-hosted `next start` server.
// It resets on restart and does NOT sync across multiple instances/edge
// nodes — fine for this app's current single-process deployment, but if it
// ever moves behind a multi-instance host, swap this for a shared store
// (e.g. the database, or Redis) instead of scaling this module up.

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

let callsSinceSweep = 0;
const SWEEP_EVERY = 500;

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Wariant trwały (Postgres, `check_rate_limit()` z
 * `scripts/migrate-rate-limit-durable.sql`) dla tras uruchamianych na
 * Vercelu. `checkRateLimit()` powyżej liczy w pamięci procesu — poprawnie
 * tylko na jednoprocesowym serwerze domowym; na Vercelu każde żądanie może
 * trafić na inną instancję funkcji i licznik prawie nie działa. Ten wariant
 * przechowuje licznik w bazie, więc działa niezależnie od tego, która
 * instancja obsłużyła żądanie.
 *
 * @param supabase - klient z aktywną sesją żądania (np. z `updateSession`),
 *   bo funkcja RPC jest wywoływana kluczem anon.
 */
export async function checkRateLimitDurable(
  supabase: {
    rpc: (
      fn: "check_rate_limit",
      args: { p_key: string; p_limit: number; p_window_seconds: number }
    ) => PromiseLike<{
      data: { allowed: boolean; retry_after_seconds: number }[] | null;
      error: unknown;
    }>;
  },
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // Baza chwilowo niedostępna nie powinna wywalać całej strony — przepuszczamy,
  // licząc na to, że to rzadkie i krótkotrwałe.
  if (error || !data?.[0]) return { allowed: true, retryAfterSeconds: 0 };

  return {
    allowed: data[0].allowed,
    retryAfterSeconds: data[0].retry_after_seconds,
  };
}

export function clientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
