import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const rawNextParam = searchParams.get("next");
  // Only accept a same-app relative path — a "/" not followed by another
  // "/" — so this can't become an open redirect to an attacker's domain
  // (e.g. `?next=https://evil.example` or `?next=//evil.example`).
  const nextParam =
    rawNextParam && rawNextParam.startsWith("/") && !rawNextParam.startsWith("//")
      ? rawNextParam
      : null;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // First login for this Supabase auth user never gets an app_user row
      // any other way — there's no DB trigger on auth.users, and this is
      // the only place a fresh session is ever seen server-side. Upsert
      // (not insert-if-missing) so a changed Google name/photo stays fresh
      // on every login too; RLS already allows self-insert/update.
      if (data.user) {
        const metadata = data.user.user_metadata ?? {};
        await supabase.from("app_user").upsert(
          {
            id: data.user.id,
            display_name: metadata.full_name ?? metadata.name ?? null,
            avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
          },
          { onConflict: "id" }
        );
        // Idempotent — every login until it's actually granted, cheap no-op
        // afterwards (or after a manager revokes it, e.g. for a ban).
        await supabase.rpc("grant_browse_permission", { uid: data.user.id });
      }

      // Bez jawnego `next` (np. z głębokiego linku) idziemy na "/", które samo
      // rozstrzyga, czy użytkownik ma ulubioną radę, czy zobaczy mapę. Ten
      // wybór stał kiedyś tutaj, ale wtedy działał tylko w chwili logowania —
      // wejście na stronę z już aktywną sesją omijało callback i lądowało na
      // mapie mimo ustawionej ulubionej rady.
      const destination = nextParam ?? "/";
      // A relative Location header instead of NextResponse.redirect(url) —
      // see /logout/route.ts for why an absolute URL built from the
      // request's origin isn't safe here.
      return new Response(null, { status: 302, headers: { Location: destination } });
    }
  }

  return new Response(null, { status: 302, headers: { Location: "/auth/error" } });
}
