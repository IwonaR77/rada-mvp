import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VotingCorrelationMatrix } from "@/components/voting-correlation-matrix";

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function CouncilVotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ councilId: string }>;
  searchParams: Promise<{ kadencja?: string }>;
}) {
  const { councilId } = await params;
  const { kadencja } = await searchParams;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name, city:city_id(name)")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const { data: terms } = await supabase
    .from("term")
    .select("id, label, start_date, end_date")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false });

  const validTermIds = new Set((terms ?? []).map((t) => t.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Same last_viewed_term_id preference /sesje uses, so the term switcher
  // stays in sync across both pages instead of drifting independently.
  let savedTermId: string | null = null;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("last_viewed_term_id")
      .eq("id", user.id)
      .maybeSingle();
    savedTermId = appUser?.last_viewed_term_id ?? null;
  }

  const selectedTermId =
    (kadencja && validTermIds.has(kadencja) ? kadencja : null) ??
    (savedTermId && validTermIds.has(savedTermId) ? savedTermId : null) ??
    terms?.[0]?.id ??
    null;

  if (user && selectedTermId && selectedTermId !== savedTermId) {
    await supabase
      .from("app_user")
      .update({ last_viewed_term_id: selectedTermId })
      .eq("id", user.id);
  }

  const selectedTerm = (terms ?? []).find((t) => t.id === selectedTermId);

  let councilors: { id: string; fullName: string }[] = [];
  let votingPairs: { a: string; b: string; agreementPct: number }[] = [];

  if (selectedTermId) {
    const [{ data: roster }, { data: correlationRows }] = await Promise.all([
      supabase
        .from("councilor_term")
        .select("councilor:councilor_id(id, full_name)")
        .eq("term_id", selectedTermId),
      supabase.rpc("term_voting_correlation", { p_term_id: selectedTermId }),
    ]);
    councilors = (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({ id: r.councilor!.id, fullName: r.councilor!.full_name }));
    votingPairs = (correlationRows ?? []).map((r) => ({
      a: r.councilor_a,
      b: r.councilor_b,
      agreementPct: r.agreement_pct,
    }));
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link
          href={`/rada/${council.id}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← {council.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Głosy — {council.name}
        </h1>
        <p className="text-zinc-500">{council.city?.name}</p>
      </div>

      {!terms || terms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Brak zarejestrowanych kadencji dla tej rady.
        </p>
      ) : (
        <>
          {terms.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {terms.map((t) => (
                <Link
                  key={t.id}
                  href={`/rada/${council.id}/glosy?kadencja=${t.id}`}
                  prefetch={false}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    t.id === selectedTermId
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.label ?? formatDate(t.start_date)}
                </Link>
              ))}
            </div>
          )}

          {selectedTerm && (
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedTerm.label ?? "Kadencja"}
              </h2>
              <p className="text-sm text-zinc-500">
                {formatDate(selectedTerm.start_date)}
                {selectedTerm.end_date
                  ? ` – ${formatDate(selectedTerm.end_date)}`
                  : " – obecnie"}
              </p>
            </div>
          )}

          {votingPairs.length > 0 ? (
            <section>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Korelacja głosowań
              </h3>
              <p className="mb-4 text-xs text-zinc-500">
                % głosowań o tym samym wyniku (ZA/PRZECIW/WSTRZYMAŁ SIĘ) między
                dwoma radnymi, liczone wyłącznie wśród uchwał, które nie
                zapadły jednomyślnie — radni pogrupowani automatycznie wg
                podobieństwa głosowań.
              </p>
              <VotingCorrelationMatrix councilors={councilors} pairs={votingPairs} />
            </section>
          ) : (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
              Brak danych o głosowaniach dla tej kadencji.
            </p>
          )}
        </>
      )}
    </div>
  );
}
