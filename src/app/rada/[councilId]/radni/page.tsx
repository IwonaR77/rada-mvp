import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RadniIndexPage({
  params,
}: {
  params: Promise<{ councilId: string }>;
}) {
  const { councilId } = await params;
  const supabase = await createClient();

  const { data: latestTerm } = await supabase
    .from("term")
    .select("id")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestTerm) {
    const { data: first } = await supabase
      .from("councilor_term")
      .select("councilor:councilor_id(id, full_name)")
      .eq("term_id", latestTerm.id)
      .order("councilor(full_name)", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (first?.councilor) {
      redirect(`/rada/${councilId}/radni/${first.councilor.id}`);
    }
  }

  return <p className="text-sm text-zinc-500">Brak radnych w tej kadencji.</p>;
}
