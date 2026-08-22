import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

function Highlight({ text }: { text: string }) {
  const parts = text.split("§§§");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded bg-amber-200 px-0.5 dark:bg-amber-800"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; councilId?: string }>;
}) {
  const { q, councilId } = await searchParams;
  const supabase = await createClient();

  const [{ data: results }, { data: council }] = await Promise.all([
    q
      ? supabase.rpc("search_segments", {
          search_query: q,
          p_council_id: councilId ?? undefined,
        })
      : Promise.resolve({ data: null }),
    councilId
      ? supabase.from("council").select("id, name").eq("id", councilId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Nazwę rady pokazujemy tylko wtedy, gdy wyniki faktycznie pochodzą z więcej
  // niż jednej — przy jednej radzie byłaby to ta sama etykieta przy każdym
  // wierszu, czyli szum.
  const spansCouncils =
    new Set((results ?? []).map((r) => r.council_id)).size > 1;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        {council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Szukaj w transkrypcjach
        </h1>
        <p className="text-sm text-zinc-500">
          {council ? (
            <>
              Wyniki tylko z rady „{council.name}”.{" "}
              <Link
                href={q ? `/szukaj?q=${encodeURIComponent(q)}` : "/szukaj"}
                className="underline"
              >
                Szukaj we wszystkich radach
              </Link>
            </>
          ) : (
            "Wyniki ze wszystkich rad."
          )}
        </p>
      </div>

      <form className="flex gap-2">
        {councilId && <input type="hidden" name="councilId" value={councilId} />}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Szukaj słowa lub frazy..."
          className="flex-1 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Szukaj
        </button>
      </form>

      {q && (
        <div className="flex flex-col gap-2">
          {!results || results.length === 0 ? (
            <p className="text-zinc-500">Brak wyników dla „{q}”.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/sesje/${r.meeting_id}?t=${r.start_time}`}
                    className="block rounded-xl border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <div className="mb-1 text-xs text-zinc-500">
                      {spansCouncils && (
                        <span className="mr-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {r.council_name}
                        </span>
                      )}
                      {r.meeting_title} — {r.meeting_date}
                    </div>
                    <div className="text-sm">
                      <Highlight text={r.headline ?? ""} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
