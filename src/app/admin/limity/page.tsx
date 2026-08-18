import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TaggingProgress } from "@/components/tagging-progress";

// Panel managera: ile zużywamy i ile zostało. Świadomie pokazuje tylko to, co
// da się sprawdzić, i mówi wprost, czego sprawdzić nie można — panel, który
// zgaduje wartości, jest gorszy niż jego brak, bo usypia czujność.
export const dynamic = "force-dynamic";

// Darmowy plan Supabase. Twarda liczba w kodzie, bo API planu nie wystawia —
// przy zmianie planu trzeba ją poprawić ręcznie i lepiej, żeby było widać gdzie.
const LIMIT_BAZY_BAJTY = 500 * 1024 * 1024;

function bajty(n: number) {
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function minuty(sekundy: number) {
  const h = Math.floor(sekundy / 3600);
  const m = Math.round((sekundy % 3600) / 60);
  return h > 0 ? `${h} godz. ${m} min` : `${m} min`;
}

function Pasek({ udzial }: { udzial: number }) {
  const proc = Math.min(100, Math.round(udzial * 100));
  const kolor =
    proc >= 90 ? "bg-red-500" : proc >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div className={`h-full ${kolor}`} style={{ width: `${proc}%` }} />
    </div>
  );
}

function Karta({
  tytul,
  podtytul,
  children,
}: {
  tytul: string;
  podtytul?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {tytul}
        </h2>
        {podtytul && <p className="text-xs text-zinc-500">{podtytul}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function LimityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isManager } = await supabase.rpc("is_manager", { uid: user.id });
  if (!isManager) notFound();

  const [{ data: statsBazy }, { data: limityRows }, { data: kadencje }] =
    await Promise.all([
      supabase.rpc("db_stats"),
      supabase.from("usage_snapshot").select("source, metric, value, unit, recorded_at"),
      supabase
        .from("term")
        .select("id, label, council:council_id(name)")
        .order("start_date", { ascending: false }),
    ]);

  // Postęp rozpisywania liczony CZASEM NAGRANIA i osobno dla każdej kadencji —
  // dokładnie tak, jak pokazuje go strona rady. Pierwsza wersja tej strony
  // liczyła wiersze w całej bazie naraz i podawała 33% tam, gdzie rada
  // pokazuje 80%: Rada Powiatu ma 44 tys. segmentów i zero zatwierdzeń, więc
  // wspólny licznik topił postęp Grójca.
  const postep = await Promise.all(
    (kadencje ?? []).map(async (k) => {
      const { data } = await supabase.rpc("term_tagging_time", { p_term_id: k.id });
      const w = data?.[0];
      return {
        id: k.id,
        nazwa: `${k.council?.name ?? "?"}${k.label ? ` — ${k.label}` : ""}`,
        total: Number(w?.total_seconds ?? 0),
        finalized: Number(w?.finalized_seconds ?? 0),
        proposed: Number(w?.proposed_seconds ?? 0),
      };
    })
  );

  const tabele = statsBazy ?? [];
  const bazaBajty = Number(tabele[0]?.baza_bajty ?? 0);
  const limity = new Map(
    (limityRows ?? []).map((r) => [`${r.source}:${r.metric}`, r])
  );



  return (
    <div className="mx-auto flex w-full max-w-[70rem] flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link href="/admin/konta" className="text-sm text-zinc-500 hover:underline">
          ← Konta
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Zużycie i limity
        </h1>
        <p className="text-zinc-500">
          Stan usług, na których stoi serwis. Widoczne wyłącznie dla managerów.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Karta
          tytul="Baza danych (Supabase)"
          podtytul={`${bajty(bazaBajty)} z ${bajty(LIMIT_BAZY_BAJTY)} darmowego planu`}
        >
          <Pasek udzial={bazaBajty / LIMIT_BAZY_BAJTY} />
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="pb-1 font-normal">Tabela</th>
                <th className="pb-1 text-right font-normal">Wierszy</th>
                <th className="pb-1 text-right font-normal">Rozmiar</th>
              </tr>
            </thead>
            <tbody>
              {tabele.slice(0, 6).map((t) => (
                <tr key={t.tabela} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 text-zinc-700 dark:text-zinc-300">{t.tabela}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-500">
                    {Number(t.wierszy).toLocaleString("pl-PL")}
                  </td>
                  <td className="py-1 text-right tabular-nums text-zinc-500">
                    {bajty(Number(t.rozmiar_bajty))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Karta>

        <Karta
          tytul="Transkrypcja (Groq)"
          podtytul="Stan limitu widać wyłącznie w odpowiedzi na wykonane żądanie — poniżej ostatni odczyt z pipeline'u transkrypcji"
        >
          {limity.size === 0 ? (
            <p className="text-sm text-zinc-500">
              Brak odczytu. Pojawi się po najbliższej transkrypcji sesji. Limity
              darmowego planu to 2 godziny audio w oknie i 2000 żądań dziennie.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {["audio", "zapytania"].map((rodzaj) => {
                const zostalo = limity.get(
                  `groq:${rodzaj === "audio" ? "audio_pozostalo_s" : "zapytania_pozostalo"}`
                );
                const limit = limity.get(
                  `groq:${rodzaj === "audio" ? "audio_limit_s" : "zapytania_limit"}`
                );
                if (!zostalo || !limit) return null;
                const z = Number(zostalo.value);
                const l = Number(limit.value);
                return (
                  <li key={rodzaj} className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {rodzaj === "audio" ? "Audio w oknie" : "Żądania"}
                      </span>
                      <span className="tabular-nums text-zinc-500">
                        {rodzaj === "audio"
                          ? `${minuty(z)} z ${minuty(l)}`
                          : `${z} z ${l}`}
                      </span>
                    </div>
                    <Pasek udzial={1 - z / l} />
                    <span className="text-xs text-zinc-400">
                      odczyt z{" "}
                      {new Date(zostalo.recorded_at).toLocaleString("pl-PL")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Karta>

        <Karta
          tytul="Rozpisywanie sesji"
          podtytul="Mierzone czasem nagrania, nie liczbą segmentów — tak samo jak na stronie rady"
        >
          <div className="flex flex-col gap-4">
            {postep
              .filter((p) => p.total > 0)
              .map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {p.nazwa}
                  </span>
                  <TaggingProgress
                    totalSeconds={p.total}
                    finalizedSeconds={p.finalized}
                    proposedSeconds={p.proposed}
                    label={`${minuty(p.total)} nagrań`}
                  />
                </div>
              ))}
          </div>
        </Karta>

        <Karta
          tytul="Czego tu nie ma"
          podtytul="Świadomie, żeby panel nie zgadywał"
        >
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              Zużycie Vercela (transfer, czas funkcji) — wymaga tokena API
              Vercela, którego serwis nie ma.
            </li>
            <li>
              Transfer i kopie zapasowe Supabase — nie są wystawiane przez API
              bazy; widać je w panelu Supabase.
            </li>
            <li>
              Bieżący stan limitu Groqa — przychodzi tylko w odpowiedzi na
              wykonane żądanie, więc panel pokazuje ostatni znany odczyt.
            </li>
          </ul>
        </Karta>
      </div>
    </div>
  );
}
