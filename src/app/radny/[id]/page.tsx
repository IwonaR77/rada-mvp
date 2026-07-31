import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

const CHOICE_LABEL: Record<string, string> = {
  za: "ZA",
  przeciw: "PRZECIW",
  wstrzymal_sie: "WSTRZYMAŁ SIĘ",
  brak_glosu: "BRAK GŁOSU",
  nieobecny: "NIEOBECNY",
};

const CHOICE_CLASS: Record<string, string> = {
  za: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  przeciw: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  wstrzymal_sie:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  brak_glosu: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  nieobecny: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function CouncilorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: councilor } = await supabase
    .from("councilor")
    .select(
      "id, full_name, photo_url, interpellation_synthesis, interpellation_synthesis_updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!councilor) notFound();

  const [{ data: termRow }, votes, { data: interpellations }, { data: similarity }] =
    await Promise.all([
      supabase
        .from("councilor_term")
        .select(
          "party, term:term_id(id, label, start_date, council:council_id(id, name))"
        )
        .eq("councilor_id", id)
        .order("term(start_date)", { ascending: false })
        .limit(1)
        .maybeSingle(),
      fetchAllRows<{
        choice: string;
        resolution: {
          id: string;
          title: string;
          esesja_number: string | null;
          meeting: { id: string; date: string; title: string | null } | null;
        } | null;
      }>((from, to) =>
        supabase
          .from("resolution_vote")
          .select(
            "choice, resolution:resolution_id(id, title, esesja_number, meeting:meeting_id(id, date, title))"
          )
          .eq("councilor_id", id)
          .range(from, to)
      ),
      supabase
        .from("interpellation")
        .select(
          "id, title, submitted_date, pdf_url, response_author_name, response_date, response_pdf_url"
        )
        .eq("author_councilor_id", id)
        .order("submitted_date", { ascending: false }),
      supabase.rpc("councilor_voting_similarity", { target_id: id }),
    ]);

  const council = termRow?.term?.council;
  const party = termRow?.party ?? null;

  const sortedVotes = [...votes]
    .filter((v) => v.resolution)
    .sort((a, b) =>
      (b.resolution!.meeting?.date ?? "").localeCompare(
        a.resolution!.meeting?.date ?? ""
      )
    );

  const voteTally = sortedVotes.reduce<Record<string, number>>((acc, v) => {
    acc[v.choice] = (acc[v.choice] ?? 0) + 1;
    return acc;
  }, {});

  const sortedSimilarity = [...(similarity ?? [])].sort(
    (a, b) => b.agreement_pct - a.agreement_pct
  );
  const mostAligned = sortedSimilarity.slice(0, 5);
  const leastAligned = [...sortedSimilarity].reverse().slice(0, 5);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div>
        {council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <div className="mt-2 flex items-center gap-4">
          {councilor.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={councilor.photo_url}
              alt={councilor.full_name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-xl font-semibold text-zinc-500 dark:bg-zinc-800">
              {councilor.full_name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {councilor.full_name}
            </h1>
            {party && <p className="text-sm text-zinc-500">{party}</p>}
          </div>
        </div>
      </div>

      {councilor.interpellation_synthesis && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            O czym pisze do urzędu
          </h2>
          <div className="rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
            <ReactMarkdown
              components={{
                p: (props) => <p className="mb-0" {...props} />,
                a: (props) => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-100"
                  />
                ),
              }}
            >
              {councilor.interpellation_synthesis}
            </ReactMarkdown>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Synteza tematów interpelacji — porównanie z przebiegiem dyskusji
            na sesji jest dostępne tylko tam, gdzie dana sesja ma już gotowe
            podsumowanie (nie wszystkie sesje kadencji są jeszcze
            rozpisane).
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Głosowania ({sortedVotes.length})
        </h2>
        {sortedVotes.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Brak zarejestrowanych głosowań tego radnego.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              {Object.entries(voteTally).map(([choice, count]) => (
                <span
                  key={choice}
                  className={`rounded-full px-3 py-1 font-medium ${CHOICE_CLASS[choice] ?? ""}`}
                >
                  {CHOICE_LABEL[choice] ?? choice}: {count}
                </span>
              ))}
            </div>
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {sortedVotes.map((v) => (
                <li
                  key={v.resolution!.id}
                  className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex flex-col gap-0.5">
                    {v.resolution!.meeting && (
                      <Link
                        href={`/sesje/${v.resolution!.meeting!.id}`}
                        prefetch={false}
                        className="text-xs text-zinc-400 hover:underline"
                      >
                        {formatDate(v.resolution!.meeting!.date)}
                      </Link>
                    )}
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">
                      {v.resolution!.esesja_number && (
                        <span className="mr-1.5 font-mono text-xs text-zinc-400">
                          {v.resolution!.esesja_number}
                        </span>
                      )}
                      {v.resolution!.title}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 self-start rounded-full px-3 py-1 text-xs font-medium sm:self-center ${CHOICE_CLASS[v.choice] ?? ""}`}
                  >
                    {CHOICE_LABEL[v.choice] ?? v.choice}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {sortedSimilarity.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Podobieństwo głosowań
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            % głosowań o tym samym wyniku (ZA/PRZECIW/WSTRZYMAŁ SIĘ) wśród
            uchwał, w których oboje radni oddali głos — liczone tylko dla par
            z co najmniej 10 wspólnymi głosowaniami.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-zinc-500">
                Najbardziej zgodni
              </h3>
              <ul className="flex flex-col gap-1.5">
                {mostAligned.map((s) => (
                  <li
                    key={s.councilor_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      href={`/radny/${s.councilor_id}`}
                      className="truncate text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {s.full_name}
                    </Link>
                    <span className="shrink-0 font-mono text-xs text-zinc-400">
                      {s.agreement_pct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-zinc-500">
                Najmniej zgodni
              </h3>
              <ul className="flex flex-col gap-1.5">
                {leastAligned.map((s) => (
                  <li
                    key={s.councilor_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      href={`/radny/${s.councilor_id}`}
                      className="truncate text-zinc-700 hover:underline dark:text-zinc-300"
                    >
                      {s.full_name}
                    </Link>
                    <span className="shrink-0 font-mono text-xs text-zinc-400">
                      {s.agreement_pct}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Wszystkie interpelacje i zapytania ({interpellations?.length ?? 0})
        </h2>
        {!interpellations || interpellations.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Brak zarejestrowanych interpelacji tego radnego.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {interpellations.map((i) => (
              <li key={i.id} className="flex flex-col gap-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-400">
                    {formatDate(i.submitted_date)}
                  </span>
                  {i.pdf_url && (
                    <a
                      href={i.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      Pobierz PDF
                    </a>
                  )}
                </div>
                <span className="text-sm text-zinc-800 dark:text-zinc-200">
                  {i.title}
                </span>
                {i.response_author_name ? (
                  <p className="text-xs text-zinc-500">
                    Odpowiedź: {i.response_author_name}
                    {i.response_date && ` — ${formatDate(i.response_date)}`}
                    {i.response_pdf_url && (
                      <>
                        {" "}
                        <a
                          href={i.response_pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
                        >
                          (PDF)
                        </a>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Brak odpowiedzi
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
