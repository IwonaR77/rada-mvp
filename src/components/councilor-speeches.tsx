import Link from "next/link";
import {
  formatClock,
  formatGap,
  DISTANT_BLOCK_GAP_SECONDS,
  type SpeechBlock,
} from "@/lib/speech-blocks";

export type SpeechSession = {
  meetingId: string;
  date: string;
  title: string | null;
  blocks: SpeechBlock[];
};

/**
 * Wypowiedzi radnego ze wszystkich sesji — kolumna obok profilu.
 *
 * Sesje zwinięte poza najnowszą: radny z kilkudziesięcioma sesjami dałby
 * inaczej stronę nie do przewinięcia. `<details>` zamiast stanu w kliencie,
 * bo to jedyna interakcja w tym panelu.
 */
export function CouncilorSpeeches({ sessions }: { sessions: SpeechSession[] }) {
  const totalBlocks = sessions.reduce((n, s) => n + s.blocks.length, 0);

  return (
    <section>
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
        Wypowiedzi na sesjach
        {totalBlocks > 0 &&
          ` (${totalBlocks} na ${sessions.length} ${sessions.length === 1 ? "sesji" : "sesjach"})`}
      </h2>
      {totalBlocks === 0 ? (
        <p className="text-sm text-zinc-500">
          Brak przypisanych wypowiedzi tego radnego. Nie znaczy to, że milczał —
          sesje są rozpisywane stopniowo.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session, i) => (
            <details
              key={session.meetingId}
              open={i === 0}
              className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <summary className="cursor-pointer text-sm text-zinc-800 marker:text-zinc-400 dark:text-zinc-200">
                {new Date(session.date).toLocaleDateString("pl-PL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                <span className="text-zinc-400">
                  {" "}
                  — {session.blocks.length}{" "}
                  {session.blocks.length === 1 ? "wypowiedź" : "wypowiedzi"}
                </span>
                {session.title && (
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {session.title}
                  </span>
                )}
              </summary>

              <div className="mt-3">
                {session.blocks.map((b) => (
                  <div key={b.start}>
                    {/* Przerwa między blokami rysowana proporcjonalnie do
                        tego, czym jest: krótka to oddech w tej samej
                        dyskusji, dłuższa to osobne wejście do dyskusji gdzie
                        indziej w porządku obrad. Granica sesji ma osobny,
                        mocniejszy podział — nagłówek grupy. */}
                    {b.gapBefore !== null &&
                      (b.gapBefore >= DISTANT_BLOCK_GAP_SECONDS ? (
                        <div className="my-3 flex items-center gap-2 text-[11px] text-zinc-400">
                          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                          <span className="shrink-0">
                            {formatGap(b.gapBefore)} przerwy
                          </span>
                          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                        </div>
                      ) : (
                        <div className="my-2 h-px bg-zinc-100 dark:bg-zinc-800" />
                      ))}
                    <Link
                      href={`/sesje/${session.meetingId}?t=${Math.floor(b.start)}`}
                      className="group flex gap-3 rounded-lg px-1 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {/* Stała szerokość kolumny: znacznik z godziną jest
                          dłuższy niż sam minutowy, a bez tego tekst obok
                          zaczynałby się w innym miejscu w każdym bloku. */}
                      <span className="w-14 shrink-0 text-right font-mono text-xs leading-6 tabular-nums text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
                        {formatClock(b.start)}
                      </span>
                      <span className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                        {b.text}
                      </span>
                    </Link>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
