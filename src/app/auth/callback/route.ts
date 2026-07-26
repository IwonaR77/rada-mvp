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
