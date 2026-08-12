import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RadniList } from "@/components/radni-list";

export default async function RadniLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ councilId: string }>;
}) {
  const { councilId } = await params;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const { data: latestTerm } = await supabase
    .from("term")
    .select("id, label")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let roster: { id: string; full_name: string }[] = [];
  if (latestTerm) {
    const { data } = await supabase
      .from("councilor_term")
      .select("councilor:councilor_id(id, full_name)")
      .eq("term_id", latestTerm.id);
    roster = (data ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({ id: r.councilor!.id, full_name: r.councilor!.full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "pl"));
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-12">
      <div>
        <Link href={`/rada/${council.id}`} className="text-sm text-zinc-500 hover:underline">
          ← {council.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Radni {latestTerm?.label ? `— ${latestTerm.label}` : ""}
        </h1>
      </div>

      <div className="flex flex-1 flex-col gap-8 md:flex-row">
        <aside className="shrink-0 md:w-56">
          <RadniList councilId={council.id} councilors={roster} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
