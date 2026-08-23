import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Stary adres sprzed przejścia na trasę zagnieżdżoną pod radą
 * (`/rada/[councilId]/radni/[councilorId]`). Trzymany jako przekierowanie,
 * żeby zewnętrzne linki/zakładki na `/radny/[id]` dalej działały.
 */
export default async function CouncilorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: termRow } = await supabase
    .from("councilor_term")
    .select("term:term_id(start_date, council_id)")
    .eq("councilor_id", id)
    .order("term(start_date)", { ascending: false })
    .limit(1)
    .maybeSingle();

  const councilId = termRow?.term?.council_id;
  if (!councilId) notFound();

  redirect(`/rada/${councilId}/radni/${id}`);
}
