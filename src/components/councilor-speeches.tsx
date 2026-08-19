import {
  formatGap,
  DISTANT_BLOCK_GAP_SECONDS,
  type SpeechBlock,
} from "@/lib/speech-blocks";
import type { Bookmark } from "@/lib/bookmarks";
import { BookmarksProvider } from "@/components/bookmarks-context";
import { BookmarkBar } from "@/components/bookmark-bar";
import { SpeechBlockRow } from "@/components/speech-block-row";

export type SpeechSession = {
  meetingId: string;
  date: string;
  title: string | null;
  blocks: SpeechBlock[];
};

function formatSessionDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Wypowiedzi radnego ze wszystkich sesji — kolumna obok profilu.
 *
 * Sesje zwinięte poza najnowszą: radny z kilkudziesięcioma sesjami dałby
 * inaczej stronę nie do przewinięcia. `<details>` zamiast stanu w kliencie,
 * bo to jedyna interakcja tego panelu poza samymi wierszami (te są już
 * klienckie — zakładki i schowek).
 */
export function CouncilorSpeeches({
  sessions,
  councilorId,
  councilorName,
  bookmarks,
  canBookmark,
  canDownloadAudio,
}: {
  sessions: SpeechSession[];
  councilorId: string;
  councilorName: string;
  bookmarks: Bookmark[];
  canBookmark: boolean;
  canDownloadAudio: boolean;
}) {
  const totalBlocks = sessions.reduce((n, s) => n + s.blocks.length, 0);

  return (
    <BookmarksProvider
      councilorId={councilorId}
      councilorName={councilorName}
      bookmarks={bookmarks}
      canBookmark={canBookmark}
      canDownloadAudio={canDownloadAudio}
    >
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Wypowiedzi na sesjach
            {totalBlocks > 0 &&
              ` (${totalBlocks} na ${sessions.length} ${sessions.length === 1 ? "sesji" : "sesjach"})`}
          </h2>
          {totalBlocks > 0 && <BookmarkBar />}
        </div>
        {totalBlocks === 0 ? (
          <p className="text-sm text-zinc-500">
            Brak przypisanych wypowiedzi tego radnego. Nie znaczy to, że milczał
            — sesje są rozpisywane stopniowo.
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
                  {formatSessionDate(session.date)}
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
                    <div key={b.segmentId}>
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
                      <SpeechBlockRow
                        segmentId={b.segmentId}
                        meetingId={session.meetingId}
                        start={b.start}
                        end={b.end}
                        text={b.text}
                        sessionDate={formatSessionDate(session.date)}
                      />
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </BookmarksProvider>
  );
}
