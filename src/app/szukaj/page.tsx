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
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const { data: results } = q
    ? await supabase.rpc("search_segments", { search_query: q })
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Szukaj w transkrypcjach
      </h1>

      <form className="flex gap-2">
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
            <p className="text-zinc-500">Brak wyników dla „{q}".</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/sesje/${r.meeting_id}?t=${r.start_time}`}
                    className="block rounded-xl border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <div className="mb-1 text-xs text-zinc-500">
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
