import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

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
      }

      // No explicit `next` (e.g. a deep link) — default a returning user
      // straight to their favorite council instead of the map. Home still
      // links to "/" for anyone who wants the map itself.
      let destination = nextParam ?? "/";
      if (!nextParam && data.user) {
        const { data: appUser } = await supabase
          .from("app_user")
          .select("favorite_council_id")
          .eq("id", data.user.id)
          .maybeSingle();
        if (appUser?.favorite_council_id) {
          destination = `/rada/${appUser.favorite_council_id}`;
        }
      }
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
