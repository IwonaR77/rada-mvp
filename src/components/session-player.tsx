"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactPlayer from "react-player";
import ReactMarkdown from "react-markdown";
import {
  buildSrt,
  buildPlainText,
  buildPlainTextWithSpeakers,
  type Segment,
  type Person,
} from "@/lib/transcript-export";
import {
  assignSegments,
  acceptProposedSegments,
  importTranscript,
  splitSegment,
  undoAssignment,
  deleteOfficial,
  type SegmentSnapshot,
} from "@/app/sesje/[id]/actions";


function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}



// Splits s.text into words tagged with their character offset in the
// original string, so clicking a word can tell the split action exactly
// where to cut ("split before this word") without re-deriving it from
// rendered text (which would break on repeated words/whitespace).
function wordsWithOffsets(text: string) {
  const words: { word: string; offset: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    words.push({ word: m[0], offset: m.index });
  }
  return words;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Short attribution for an embedded third-party video, per the site's own
// terms of use for embedding — the registrable domain (e.g. "esesja.tv"),
// not the full CDN URL with its per-session path.
function videoSourceLabel(url: string) {
  try {
    const parts = new URL(url).hostname.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : parts.join(".");
  } catch {
    return null;
  }
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Same sesja_<esesja_id>_<date> prefix as the transcription pipeline's
// video/vtt files and the summary/*.md files it feeds — a downloaded
// transcript named from the (long, freeform) meeting title instead made it
// easy to lose track of which summary belongs to which session once both
// sat in the same folder. The "_transkrypcja" suffix (paired with
// "_podsumowanie" on the prompt-generated summary, see
// prompty-prywatne/summary/prompt.md's NAZEWNICTWO PLIKU) keeps the two tellable apart at a
// glance too, not just by extension. Falls back to the old title-based
// slug only for the rare meeting with no esesja_id.
function sessionFileBase(
  sessionKey: string | null,
  date: string,
  title: string
) {
  return sessionKey
    ? `sesja_${sessionKey}_${date}_transkrypcja`
    : slugify(title);
}

export function SessionPlayer({
  meetingId,
  meetingTitle,
  sessionKey,
  sessionNumber,
  councilName,
  meetingDate,
  existingTopics,
  summary,
  summaryPromptVersion,
  currentPromptVersion,
  videoUrl,
  segments,
  councilors,
  officials,
  speakerUsage,
  isAdmin,
  canAssign,
  canFinalize,
  canDownloadTranscript,
  summaryManager,
  taggingProgress,
  initialSeek,
}: {
  meetingId: string;
  meetingTitle: string;
  /** esesja_id albo source_id — rady spoza esesja.pl nie mają tego pierwszego. */
  sessionKey: string | null;
  sessionNumber: number | null;
  councilName: string | null;
  meetingDate: string;
  existingTopics: string[];
  summary: string | null;
  /** Wersja promptu, którą wygenerowano ten tekst; null dla starszych wpisów. */
  summaryPromptVersion: number | null;
  currentPromptVersion: number;
  videoUrl: string;
  segments: Segment[];
  councilors: Person[];
  officials: { id: string; full_name: string; role: string }[];
  /**
   * Ile wypowiedzi ma przypisanych każdy mówca w całej radzie (nie tylko w tej
   * sesji). Brak klucza = zero. Odróżnia osobę faktycznie używaną od wpisu,
   * który nigdy nikomu nie posłużył — tylko takie wolno usunąć.
   */
  speakerUsage: Record<string, number>;
  isAdmin: boolean;
  canAssign: boolean;
  canFinalize: boolean;
  canDownloadTranscript: boolean;
  /**
   * Panel managera pod podsumowaniem (wgranie .md, prompt, uwagi). Wchodzi
   * gotowym węzłem, a nie flagą uprawnień — o tym, czy manager go widzi,
   * decyduje strona, która i tak sprawdza uprawnienia dla reszty widoku.
   */
  summaryManager?: ReactNode;
  /** Pasek postępu tagowania tej sesji, nad listą wypowiedzi. */
  taggingProgress?: ReactNode;
  initialSeek?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hasAppliedInitialSeek = useRef(false);
  // While the user is scrolling ahead of playback to pre-tag segments,
  // don't yank them back to the currently playing row on every segment
  // change. Resumes once they click a segment to seek — that's an
  // explicit "take me here" action.
  const followPlaybackRef = useRef(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unassigned" | "proposed">(
    "all"
  );
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [forceReimport, setForceReimport] = useState(false);
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Jedno cofnięcie, nie historia zmian: pamiętamy wyłącznie ostatnie
  // przypisanie i tylko do najbliższej innej akcji. Świadomie bez stosu —
  // przy tagowaniu setek segmentów głębokie cofanie po kilku minutach klikania
  // trafiałoby w stan, którego już się nie pamięta, a to gorsze niż brak
  // cofania. Stan żyje w komponencie, więc odświeżenie strony go kasuje.
  const [lastAssignment, setLastAssignment] = useState<{
    previous: SegmentSnapshot[];
    label: string;
  } | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Dokąd doszło ostatnie „następny nieprzypisany". Trzymane osobno od
  // zaznaczenia i od odtwarzania, bo przeskakiwanie po dziurach to inna
  // czynność niż tagowanie tego, co akurat leci.
  const [jumpCursor, setJumpCursor] = useState<string | null>(null);
  const router = useRouter();

  const activeSegment = segments.find(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  );

  const isUnassigned = (s: Segment) =>
    !s.confirmed_councilor_id && !s.confirmed_official_id;
  const getAssignedId = (s: Segment) =>
    s.confirmed_councilor_id ?? s.confirmed_official_id;
  const unassignedCount = segments.filter(isUnassigned).length;
  const proposedCount = segments.filter((s) => s.status === "proposed").length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSegments = segments
    .filter((s) => {
      if (filter === "unassigned") return isUnassigned(s);
      if (filter === "proposed") return s.status === "proposed";
      return true;
    })
    .filter((s) =>
      normalizedQuery ? s.text.toLowerCase().includes(normalizedQuery) : true
    )
    .filter((s) => {
      if (speakerFilter.size === 0) return true;
      const assignedId = getAssignedId(s);
      return assignedId ? speakerFilter.has(assignedId) : false;
    });

  const speakingIds = new Set(
    segments.map(getAssignedId).filter((id): id is string => Boolean(id))
  );

  // Czas mówienia w TEJ sesji — porządkuje listę mówców tak, żeby osoby
  // prowadzące obrady i najczęściej zabierające głos były najwyżej. Liczone
  // z segmentów już wczytanych na stronę, bez dodatkowego zapytania.
  const speakingSeconds = new Map<string, number>();
  for (const seg of segments) {
    const id = getAssignedId(seg);
    if (!id) continue;
    speakingSeconds.set(
      id,
      (speakingSeconds.get(id) ?? 0) + Number(seg.end_time) - Number(seg.start_time)
    );
  }

  const proposedSegments = segments.filter((s) => s.status === "proposed");
  const selectedProposedIds = Array.from(selected).filter((id) =>
    proposedSegments.some((s) => s.id === id)
  );

  function handleLoadedMetadata() {
    if (hasAppliedInitialSeek.current || initialSeek === undefined) return;
    hasAppliedInitialSeek.current = true;
    handleSeek(initialSeek);
  }

  const peopleById = new Map<string, string>();
  councilors.forEach((c) => peopleById.set(c.id, c.name));
  officials.forEach((o) => peopleById.set(o.id, `${o.full_name} (${o.role})`));

  useEffect(() => {
    if (!followPlaybackRef.current) return;
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSegment?.id]);

  function handleSeek(startTime: number) {
    followPlaybackRef.current = true;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = startTime;
    video.play();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shift+click extends from the anchor (last plain click, or the
  // currently playing segment if nothing's been clicked yet) through the
  // clicked segment, matching standard file-manager range-select — but adds
  // the range to the existing selection rather than replacing it, so it
  // composes with individually-checked segments elsewhere in the list.
  function handleSegmentClick(id: string, shiftKey: boolean) {
    if (!shiftKey) {
      toggleSelected(id);
      setAnchorId(id);
      return;
    }
    const anchor = anchorId ?? activeSegment?.id ?? id;
    const ids = visibleSegments.map((s) => s.id);
    const anchorIndex = ids.indexOf(anchor);
    const clickedIndex = ids.indexOf(id);
    if (anchorIndex === -1 || clickedIndex === -1) {
      toggleSelected(id);
      return;
    }
    const [start, end] =
      anchorIndex < clickedIndex
        ? [anchorIndex, clickedIndex]
        : [clickedIndex, anchorIndex];
    const rangeIds = ids.slice(start, end + 1);
    setSelected((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((rid) => next.add(rid));
      return next;
    });
  }

  /**
   * Przewija listę do kolejnego segmentu bez mówcy — bez zmiany filtra, żeby
   * sąsiedztwo zostało widoczne (po nim najczęściej poznaje się, kto mówi).
   *
   * Punkt startu: ostatni przeskok, a przy pierwszym kliknięciu segment, który
   * akurat leci. Po dojściu do końca zawija na początek, więc przycisk nigdy
   * nie robi „nic" przy niepustej liście dziur.
   */
  function jumpToNextUnassigned() {
    const list = visibleSegments;
    const from = jumpCursor ?? activeSegment?.id ?? null;
    const fromIndex = from ? list.findIndex((s) => s.id === from) : -1;
    const next =
      list.slice(fromIndex + 1).find(isUnassigned) ?? list.find(isUnassigned);
    if (!next) return;

    setJumpCursor(next.id);
    // Bez tego efekt podążania za odtwarzaniem ściągnąłby widok z powrotem
    // przy najbliższej zmianie segmentu.
    followPlaybackRef.current = false;

    const container = listRef.current;
    const row = document.getElementById(`seg-${next.id}`);
    if (!container || !row) return;
    // Przewijamy samą listę, nie stronę — `scrollIntoView` ruszyłby całym
    // widokiem, odsuwając odtwarzacz.
    const delta =
      row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop +=
      delta - container.clientHeight / 2 + row.clientHeight / 2;
  }

  function toggleSpeakerFilter(id: string) {
    setSpeakerFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assignTo(target: { type: "councilor" | "official"; id: string }) {
    const ids = Array.from(selected);
    const label = peopleById.get(target.id) ?? "?";
    startTransition(async () => {
      const result = await assignSegments(meetingId, ids, target);
      setAssignError(result.error);
      setLastAssignment(
        result.error ? null : { previous: result.previous ?? [], label }
      );
      setSelected(new Set());
    });
  }

  function removeOfficial(id: string, label: string) {
    if (
      !window.confirm(
        `Usunąć „${label}" z listy mówców tej rady? Nie ma przypisanych wypowiedzi, więc nic nie przepadnie.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteOfficial(meetingId, id);
      setAssignError(result.error);
    });
  }

  function undoLastAssignment() {
    if (!lastAssignment) return;
    startTransition(async () => {
      const result = await undoAssignment(meetingId, lastAssignment.previous);
      setAssignError(result.error);
      if (!result.error) setLastAssignment(null);
    });
  }

  function acceptSelected() {
    setLastAssignment(null);
    startTransition(async () => {
      await acceptProposedSegments(meetingId, selectedProposedIds);
      setSelected(new Set());
    });
  }

  function acceptAll() {
    if (
      !window.confirm(
        `Zatwierdzić wszystkie ${proposedSegments.length} propozycji w tej sesji?`
      )
    ) {
      return;
    }
    setLastAssignment(null);
    startTransition(async () => {
      await acceptProposedSegments(
        meetingId,
        proposedSegments.map((s) => s.id)
      );
      setSelected(new Set());
    });
  }

  function handleSplit(segmentId: string, offset: number) {
    setSplitError(null);
    // Podział tworzy nowe segmenty w miejsce starego, więc migawka sprzed
    // podziału wskazywałaby na wiersze, których już nie ma.
    setLastAssignment(null);
    startTransition(async () => {
      const result = await splitSegment(meetingId, segmentId, offset);
      if (result.error) setSplitError(result.error);
      else {
        setSplittingId(null);
        router.refresh();
      }
    });
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsImporting(true);
    setImportError(null);
    try {
      const content = await file.text();
      const result = await importTranscript(meetingId, content, forceReimport);
      if (result.error) setImportError(result.error);
      else router.refresh();
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex w-full flex-col gap-3 lg:order-first lg:flex-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Podsumowanie
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-200 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          {summary ? (
            <ReactMarkdown
              components={{
                h1: (props) => (
                  <h3 className="mb-2 mt-4 text-base font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100" {...props} />
                ),
                h2: (props) => (
                  <h3 className="mb-2 mt-4 text-sm font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100" {...props} />
                ),
                h3: (props) => (
                  <h4 className="mb-1 mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100" {...props} />
                ),
                p: (props) => <p className="mb-3 last:mb-0" {...props} />,
                ul: (props) => <ul className="mb-3 list-disc space-y-1 pl-5" {...props} />,
                ol: (props) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...props} />,
                li: (props) => <li {...props} />,
                strong: (props) => <strong className="font-semibold text-zinc-900 dark:text-zinc-100" {...props} />,
              }}
            >
              {summary}
            </ReactMarkdown>
          ) : (
            <p className="text-zinc-400">Brak podsumowania.</p>
          )}
        </div>
        {summary && (
          // Podsumowania pisze model według wersjonowanego promptu, a kolejne
          // wersje realnie zmieniają zakres (np. v4 dodał datę wygenerowania,
          // v7 nazwę rady z nagłówka). Bez tej stopki czytelnik nie ma jak
          // odróżnić tekstu sprzed dwóch podbić od świeżego.
          <p className="text-xs text-zinc-400">
            {summaryPromptVersion === null ? (
              "Wygenerowano nieznaną wersją promptu podsumowań."
            ) : summaryPromptVersion >= currentPromptVersion ? (
              <>
                Wygenerowano{" "}
                <Link href="/prompt-podsumowania" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
                  promptem v{summaryPromptVersion}
                </Link>
                .
              </>
            ) : (
              // Strona /prompt-podsumowania pokazuje zawsze wersję aktualną,
              // więc przy starszym podsumowaniu link prowadziłby do promptu,
              // którym ten tekst NIE powstał — dlatego bez odsyłacza.
              `Wygenerowano promptem v${summaryPromptVersion} — starszym niż obecny v${currentPromptVersion}.`
            )}
          </p>
        )}
        {summaryManager}
      </div>

      <div className="flex flex-1 flex-col gap-6">
        <ReactPlayer
          ref={videoRef}
          src={videoUrl}
          controls
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={handleLoadedMetadata}
          style={{ width: "100%", height: "auto", aspectRatio: "16/9" }}
        />
        {videoSourceLabel(videoUrl) && (
          <p className="-mt-4 text-xs text-zinc-400">
            Źródło: {videoSourceLabel(videoUrl)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj w tej sesji..."
            className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />
          <div className="inline-flex rounded-full border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1 transition-colors ${
                filter === "all"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Wszystkie
            </button>
            <button
              onClick={() => setFilter("unassigned")}
              className={`rounded-full px-3 py-1 transition-colors ${
                filter === "unassigned"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Nieustalone{unassignedCount > 0 && ` (${unassignedCount})`}
            </button>
            <button
              onClick={() => setFilter("proposed")}
              className={`rounded-full px-3 py-1 transition-colors ${
                filter === "proposed"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              Niezaakceptowane{proposedCount > 0 && ` (${proposedCount})`}
            </button>
          </div>

          {/* Skok do dziury zamiast filtrowania: filtr „Nieustalone" pokazuje
              same dziury, a wtedy nie widać, co padło obok — a to zwykle
              jedyna wskazówka, kto mówi. */}
          <button
            onClick={jumpToNextUnassigned}
            disabled={!visibleSegments.some(isUnassigned)}
            title="Przewija listę do kolejnego segmentu bez przypisanego mówcy"
            className="rounded-full border border-amber-300 px-3 py-1 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
          >
            ↓ {jumpCursor ? "Następny" : "Pierwszy"} nieprzypisany
          </button>

          <div className="ml-auto flex gap-2">
            {canDownloadTranscript && (
              <>
                <button
                  disabled={segments.length === 0}
                  onClick={() =>
                    downloadFile(
                      `${sessionFileBase(sessionKey, meetingDate, meetingTitle)}.txt`,
                      buildPlainText(segments, {
                        sessionKey,
                        sessionNumber,
                        councilName,
                        date: meetingDate,
                        title: meetingTitle,
                        existingTopics,
                      }),
                      "text/plain;charset=utf-8"
                    )
                  }
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Pobierz .txt
                </button>
                <button
                  disabled={segments.length === 0}
                  onClick={() =>
                    downloadFile(
                      `${sessionFileBase(sessionKey, meetingDate, meetingTitle)}_mowcy.txt`,
                      buildPlainTextWithSpeakers(
                        segments,
                        peopleById,
                        councilors,
                        officials,
                        {
                          sessionKey,
                          sessionNumber,
                          councilName,
                          date: meetingDate,
                          title: meetingTitle,
                          existingTopics,
                        }
                      ),
                      "text/plain;charset=utf-8"
                    )
                  }
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Pobierz .txt (z mówcami)
                </button>
                <button
                  disabled={segments.length === 0}
                  onClick={() =>
                    downloadFile(
                      `${sessionFileBase(sessionKey, meetingDate, meetingTitle)}.srt`,
                      buildSrt(segments),
                      "application/x-subrip;charset=utf-8"
                    )
                  }
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Pobierz .srt
                </button>
              </>
            )}
          </div>
        </div>

        {taggingProgress && <div className="mb-3">{taggingProgress}</div>}
        <ul
          ref={listRef}
          onWheel={() => {
            followPlaybackRef.current = false;
          }}
          onTouchMove={() => {
            followPlaybackRef.current = false;
          }}
          className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 p-2 dark:border-zinc-800"
        >
          {visibleSegments.length === 0 && (
            <li className="p-4 text-center text-zinc-500">
              {normalizedQuery
                ? `Brak wyników dla „${query}".`
                : speakerFilter.size > 0
                  ? "Brak wypowiedzi zaznaczonych mówców w tej sesji."
                  : filter === "unassigned"
                    ? "Wszystkie segmenty mają przypisanego mówcę."
                    : filter === "proposed"
                      ? "Brak niezaakceptowanych propozycji."
                      : "Brak segmentów dla tej sesji."}
            </li>
          )}
          {visibleSegments.map((s) => {
            const isActive = activeSegment?.id === s.id;
            const assignedId = s.confirmed_councilor_id ?? s.confirmed_official_id;
            const isProposed = Boolean(assignedId) && s.status === "proposed";
            return (
              <li
                key={s.id}
                id={`seg-${s.id}`}
                ref={isActive ? activeRowRef : undefined}
                className={`flex items-start gap-2 rounded-xl px-2 py-2 transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : !assignedId
                      ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                      : isProposed
                        ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {canAssign && splittingId !== s.id && (
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={(e) => {
                      const shiftKey = (e.nativeEvent as MouseEvent).shiftKey;
                      handleSegmentClick(s.id, shiftKey);
                    }}
                    className="mt-1 shrink-0"
                  />
                )}
                {splittingId === s.id ? (
                  <div className="flex flex-1 flex-col gap-1 text-sm">
                    <p className="text-xs text-zinc-500">
                      Kliknij słowo, od którego zaczyna się druga wypowiedź:
                    </p>
                    <div className="flex flex-wrap gap-x-1">
                      {wordsWithOffsets(s.text).map(({ word, offset }, i) =>
                        i === 0 ? (
                          <span key={offset}>{word}</span>
                        ) : (
                          <button
                            key={offset}
                            disabled={isPending}
                            onClick={() => handleSplit(s.id, offset)}
                            className="rounded hover:bg-blue-200 hover:underline dark:hover:bg-blue-900"
                          >
                            {word}
                          </button>
                        )
                      )}
                    </div>
                    <button
                      onClick={() => setSplittingId(null)}
                      className="self-start text-xs text-zinc-500 underline"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleSeek(s.start_time)}
                      className="flex flex-1 flex-col gap-0.5 text-left text-sm"
                    >
                      <div className="flex gap-3">
                        <span
                          className={`shrink-0 font-mono ${
                            isActive ? "" : "text-zinc-400"
                          }`}
                        >
                          {formatTime(s.start_time)}
                        </span>
                        <span>{s.text}</span>
                      </div>
                      {assignedId && (
                        <span
                          className={`text-xs ${
                            isActive
                              ? "text-zinc-300"
                              : isProposed
                                ? "text-blue-700 dark:text-blue-400"
                                : "text-zinc-400"
                          }`}
                        >
                          {peopleById.get(assignedId) ?? "?"}
                          {isProposed && " — propozycja, czeka na zatwierdzenie"}
                        </span>
                      )}
                    </button>
                    {canFinalize && (
                      <button
                        onClick={() => setSplittingId(s.id)}
                        title="Podziel segment (dwóch mówców w jednym segmencie)"
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                          isActive
                            ? "hover:bg-zinc-700 dark:hover:bg-zinc-300"
                            : "text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }`}
                      >
                        ✂️
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {splitError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {splitError}
          </p>
        )}

        {isAdmin && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            {segments.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Ta sesja nie ma jeszcze zaimportowanego transkryptu.
              </p>
            ) : (
              <p className="text-sm text-zinc-500">
                Ta sesja ma już {segments.length} segment(ów) — zaznacz
                &bdquo;force&rdquo;, by je zastąpić nowym importem.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="cursor-pointer rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                {isImporting ? "Importowanie..." : "Wybierz plik .vtt"}
                <input
                  type="file"
                  accept=".vtt"
                  onChange={handleImportFile}
                  disabled={isImporting}
                  className="hidden"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={forceReimport}
                  onChange={(e) => setForceReimport(e.target.checked)}
                />
                force
              </label>
            </div>
            {importError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {importError}
              </p>
            )}
          </div>
        )}
      </div>

      {canAssign && (
        <div className="flex w-full flex-col gap-4 lg:w-64">
          <p className="text-sm text-zinc-500">
            Zaznaczono: {selected.size} segment(ów)
          </p>

          {/* Nad listą mówców, a nie pod nią: pomyłkę widać od razu po
              kliknięciu, a lista bywa długa i przycisk pod nią byłby poza
              ekranem dokładnie wtedy, gdy jest potrzebny. */}
          {lastAssignment && (
            <button
              disabled={isPending}
              onClick={undoLastAssignment}
              className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/60"
            >
              ↶ Cofnij ostatnie przypisanie
              <span className="mt-0.5 block text-xs font-normal opacity-80">
                {lastAssignment.previous.length} segm. → {lastAssignment.label}
              </span>
            </button>
          )}

          {assignError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {assignError}
            </p>
          )}

          {canFinalize && proposedSegments.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                Propozycji do zatwierdzenia: {proposedSegments.length}
              </p>
              <button
                disabled={selectedProposedIds.length === 0 || isPending}
                onClick={acceptSelected}
                className="rounded-full bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Zaakceptuj wybrane propozycje
                {selectedProposedIds.length > 0 && ` (${selectedProposedIds.length})`}
              </button>
              <button
                disabled={isPending}
                onClick={acceptAll}
                className="rounded-full border border-blue-700 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/50"
              >
                Zaakceptuj wszystkie propozycje ({proposedSegments.length})
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Filtruj po mówcy
            </h3>
            {/* Lista mówców przychodzi z serwera jako props, więc nowa osoba
                dopisana w bazie w trakcie tagowania nie pojawia się sama.
                `router.refresh()` dociąga ją, NIE gubiąc stanu komponentu —
                zaznaczone segmenty, filtry i kursor skoku zostają. Przeładowanie
                strony (F5) kasowałoby to wszystko. */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => startTransition(() => router.refresh())}
                disabled={isPending}
                title="Dociąga nowo dodanych mówców bez utraty zaznaczenia"
                className="text-xs text-zinc-500 underline hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-300"
              >
                ↻ Odśwież listę
              </button>
              {speakerFilter.size > 0 && (
                <button
                  onClick={() => setSpeakerFilter(new Set())}
                  className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Wyświetl wszystko
                </button>
              )}
            </div>
          </div>

          <SpeakerList
            people={[
              ...councilors.map((c) => ({
                id: c.id,
                label: c.name,
                sub: null,
                // Radnych nie usuwa się z listy mówców — skład rady to nie
                // jest lista do sprzątania przy tagowaniu.
                removable: false,
                target: { type: "councilor" as const, id: c.id },
              })),
              ...officials.map((o) => ({
                id: o.id,
                label: o.full_name,
                sub: o.role,
                removable: canFinalize,
                target: { type: "official" as const, id: o.id },
              })),
            ]}
            speakingIds={speakingIds}
            speakingSeconds={speakingSeconds}
            speakerUsage={speakerUsage}
            speakerFilter={speakerFilter}
            onToggleFilter={toggleSpeakerFilter}
            onAssign={assignTo}
            onRemove={removeOfficial}
            disabled={selected.size === 0 || isPending}
            actionsDisabled={isPending}
          />
        </div>
      )}
    </div>
  );
}

type SpeakerTarget =
  | { type: "councilor"; id: string }
  | { type: "official"; id: string };

type SpeakerEntry = {
  id: string;
  label: string;
  /** Dopisek przy nazwisku — dla urzędników funkcja, dla radnych nic. */
  sub: string | null;
  /** Czy w ogóle wolno tę pozycję usunąć (radni: nigdy; urzędnicy: moderator). */
  removable: boolean;
  target: SpeakerTarget;
};

/**
 * Lista mówców do przypisania, wspólna dla radnych i urzędników.
 *
 * Bez podziału na kategorie celowo: przy tagowaniu szuka się konkretnej osoby,
 * a nie jej formalnej przynależności, a dwie listy znaczyły dwa miejsca do
 * przewinięcia. Urzędnika poznaje się po dopisanej funkcji — kto go nie ma,
 * jest radnym.
 *
 * Lista rady miejskiej ma 43 pozycje, a w jednej sesji pada mediana 10 różnych
 * mówców — bez wyciągnięcia ich na górę szuka się jednej czwartej listy
 * wśród całości.
 *
 * Podział, a nie zmiana kolejności całej listy: pozycje nie przeskakują pod
 * kursorem w trakcie klikania. Przy tagowaniu setek segmentów lista
 * przestawiająca się po każdym kliknięciu to gotowe źródło cichych pomyłek
 * w danych o konkretnych osobach.
 *
 * „W tej sesji" obejmuje też przypisania jeszcze niezatwierdzone — propozycje
 * z dopasowania do protokołów dają obsadę sesji, zanim człowiek kliknie
 * cokolwiek, i to jest dokładnie ten moment, w którym skrót jest najbardziej
 * potrzebny.
 */
function SpeakerList({
  people,
  speakingIds,
  speakingSeconds,
  speakerUsage,
  speakerFilter,
  onToggleFilter,
  onAssign,
  onRemove,
  disabled,
  actionsDisabled,
}: {
  people: SpeakerEntry[];
  speakingIds: Set<string>;
  /** Czas mówienia w tej sesji, w sekundach — porządek sekcji „W tej sesji". */
  speakingSeconds: Map<string, number>;
  /** Liczba przypisanych wypowiedzi w całej radzie; brak klucza = zero. */
  speakerUsage: Record<string, number>;
  speakerFilter: Set<string>;
  onToggleFilter: (id: string) => void;
  onAssign: (target: SpeakerTarget) => void;
  onRemove: (id: string, label: string) => void;
  disabled: boolean;
  /** Kosz blokujemy osobno: usuwanie nie wymaga zaznaczonych segmentów. */
  actionsDisabled: boolean;
}) {
  // Najwięcej mówiący na górze. Przy równym czasie alfabetycznie, żeby
  // kolejność była powtarzalna, a nie zależna od kolejności wczytania.
  const inSession = people
    .filter((p) => speakingIds.has(p.id))
    .sort(
      (a, b) =>
        (speakingSeconds.get(b.id) ?? 0) - (speakingSeconds.get(a.id) ?? 0) ||
        a.label.localeCompare(b.label, "pl")
    );
  // Pozostali zostają alfabetycznie — wszyscy mają zero, więc sortowanie
  // czasem dałoby im kolejność przypadkową.
  const rest = people.filter((p) => !speakingIds.has(p.id));

  const row = (p: SpeakerEntry) => {
    const usage = speakerUsage[p.id] ?? 0;
    return (
    <li
      key={p.id}
      className={`group flex items-center gap-2 rounded-lg px-2 py-0.5 ${
        speakingIds.has(p.id) ? "bg-emerald-50 dark:bg-emerald-950/30" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={speakerFilter.has(p.id)}
        onChange={() => onToggleFilter(p.id)}
        className="shrink-0"
      />
      {/* Wyróżnik ma być dyskretny, więc kropka, nie liczba: przy tagowaniu
          liczy się jedna informacja — czy ta pozycja komukolwiek kiedykolwiek
          posłużyła. Pusty placeholder o tej samej szerokości trzyma nazwiska
          w jednej kolumnie, żeby brak kropki nie przesuwał wiersza. */}
      {usage > 0 ? (
        <span
          title={`Ma przypisane wypowiedzi: ${usage}`}
          className="w-1.5 shrink-0 text-center text-[10px] leading-none text-emerald-600/70 dark:text-emerald-500/70"
        >
          ●
        </span>
      ) : (
        <span className="w-1.5 shrink-0" aria-hidden />
      )}
      <button
        disabled={disabled}
        onClick={() => onAssign(p.target)}
        className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${
          speakingIds.has(p.id) ? "font-semibold" : ""
        }`}
      >
        {p.label}
        {p.sub && <span className="text-zinc-400"> — {p.sub}</span>}
        {/* Czas obok nazwiska, żeby kolejność sekcji nie wyglądała
            na przypadkową. */}
        {speakingSeconds.has(p.id) && (
          <span className="float-right tabular-nums text-xs text-zinc-400">
            {formatTime(speakingSeconds.get(p.id) ?? 0)}
          </span>
        )}
      </button>
      {/* Kosz tylko przy pozycjach bez ani jednej przypisanej wypowiedzi —
          usunięcie osoby, która je ma, odpięłoby je po cichu (ON DELETE SET
          NULL). Widoczny dopiero po najechaniu, żeby nie robić z listy
          mówców panelu administracyjnego. */}
      {p.removable && usage === 0 && (
        <button
          disabled={actionsDisabled}
          onClick={() => onRemove(p.id, p.label)}
          title="Usuń z listy mówców — ta osoba nie ma żadnych wypowiedzi"
          aria-label={`Usuń ${p.label} z listy mówców`}
          className="shrink-0 rounded px-1 text-zinc-300 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 disabled:opacity-30 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-red-400"
        >
          🗑
        </button>
      )}
    </li>
    );
  };

  return (
    <div>
      {/* Podpisy pojawiają się dopiero, gdy jest co wyciągnąć na górę —
          dla nietkniętej sesji lista wygląda dokładnie jak dotąd. */}
      {inSession.length > 0 ? (
        <>
          <p className="mb-1 text-xs text-emerald-700 dark:text-emerald-500">
            W tej sesji ({inSession.length})
          </p>
          <ul className="flex flex-col gap-1">{inSession.map(row)}</ul>
          {rest.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs text-zinc-400">Pozostali</p>
              <ul className="flex flex-col gap-1">{rest.map(row)}</ul>
            </>
          )}
        </>
      ) : (
        <ul className="flex flex-col gap-1">{people.map(row)}</ul>
      )}
    </div>
  );
}
