import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // A relative Location header (valid per RFC 7231) instead of
  // NextResponse.redirect(new URL("/", request.url)) — `next start` here
  // hardcodes request.url's origin to localhost regardless of the actual
  // Host header, which would send LAN/remote clients to an unreachable URL.
  return new Response(null, { status: 302, headers: { Location: "/" } });
}
