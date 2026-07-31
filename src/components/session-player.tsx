"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactPlayer from "react-player";
import ReactMarkdown from "react-markdown";
import {
  assignSegments,
  acceptProposedSegments,
  importTranscript,
} from "@/app/sesje/[id]/actions";

type Segment = {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
  confirmed_councilor_id: string | null;
  confirmed_official_id: string | null;
  status: string;
};

type Person = { id: string; name: string; role?: string };

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function toSrtTimestamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildSrt(segments: Segment[]) {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${toSrtTimestamp(s.start_time)} --> ${toSrtTimestamp(s.end_time)}\n${s.text}\n`
    )
    .join("\n");
}

function buildPlainText(
  segments: Segment[],
  meta: {
    esesjaId: string | null;
    date: string;
    title: string;
    existingTopics: string[];
  }
) {
  // A header up front so pasting this file straight into the summary
  // prompt already carries the esesja_id/date/existing-tags it needs —
  // no separate manual "fill in METADANE" step, no back-and-forth asking
  // for it, and no drifting tag vocabulary across sessions.
  const header = [
    meta.esesjaId ? `esesja_id: ${meta.esesjaId}` : null,
    `data: ${meta.date}`,
    `tytuł: ${meta.title}`,
    meta.existingTopics.length > 0
      ? `tagi: ${meta.existingTopics.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${segments.map((s) => s.text).join("\n\n")}`;
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

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function SessionPlayer({
  meetingId,
  meetingTitle,
  esesjaId,
  meetingDate,
  existingTopics,
  summary,
  videoUrl,
  segments,
  councilors,
  officials,
  isAdmin,
  canAssign,
  canFinalize,
  canDownloadTranscript,
  initialSeek,
}: {
  meetingId: string;
  meetingTitle: string;
  esesjaId: string | null;
  meetingDate: string;
  existingTopics: string[];
  summary: string | null;
  videoUrl: string;
  segments: Segment[];
  councilors: Person[];
  officials: { id: string; full_name: string; role: string }[];
  isAdmin: boolean;
  canAssign: boolean;
  canFinalize: boolean;
  canDownloadTranscript: boolean;
  initialSeek?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);
  const hasAppliedInitialSeek = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unassigned">("all");
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [forceReimport, setForceReimport] = useState(false);
  const router = useRouter();

  const activeSegment = segments.find(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  );

  const isUnassigned = (s: Segment) =>
    !s.confirmed_councilor_id && !s.confirmed_official_id;
  const getAssignedId = (s: Segment) =>
    s.confirmed_councilor_id ?? s.confirmed_official_id;
  const unassignedCount = segments.filter(isUnassigned).length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSegments = segments
    .filter((s) => (filter === "unassigned" ? isUnassigned(s) : true))
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
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSegment?.id]);

  function handleSeek(startTime: number) {
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

  function toggleSpeakerFilter(id: string) {
    setSpeakerFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assignTo(target: { type: "councilor" | "official"; id: string }) {
    startTransition(async () => {
      await assignSegments(meetingId, Array.from(selected), target);
      setSelected(new Set());
    });
  }

  function acceptSelected() {
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
    startTransition(async () => {
      await acceptProposedSegments(
        meetingId,
        proposedSegments.map((s) => s.id)
      );
      setSelected(new Set());
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
          </div>

          <div className="ml-auto flex gap-2">
            {canDownloadTranscript && (
              <>
                <button
                  disabled={segments.length === 0}
                  onClick={() =>
                    downloadFile(
                      `${slugify(meetingTitle)}.txt`,
                      buildPlainText(segments, {
                        esesjaId,
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
                      `${slugify(meetingTitle)}.srt`,
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

        <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-200 p-2 dark:border-zinc-800">
          {visibleSegments.length === 0 && (
            <li className="p-4 text-center text-zinc-500">
              {normalizedQuery
                ? `Brak wyników dla „${query}".`
                : speakerFilter.size > 0
                  ? "Brak wypowiedzi zaznaczonych mówców w tej sesji."
                  : filter === "unassigned"
                    ? "Wszystkie segmenty mają przypisanego mówcę."
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
                {canAssign && (
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleSelected(s.id)}
                    className="mt-1 shrink-0"
                  />
                )}
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
              </li>
            );
          })}
        </ul>

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
            {speakerFilter.size > 0 && (
              <button
                onClick={() => setSpeakerFilter(new Set())}
                className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Wyświetl wszystko
              </button>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Radni
            </h3>
            <ul className="flex flex-col gap-1">
              {councilors.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-0.5 ${
                    speakingIds.has(c.id)
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={speakerFilter.has(c.id)}
                    onChange={() => toggleSpeakerFilter(c.id)}
                    className="shrink-0"
                  />
                  <button
                    disabled={selected.size === 0 || isPending}
                    onClick={() => assignTo({ type: "councilor", id: c.id })}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${
                      speakingIds.has(c.id) ? "font-semibold" : ""
                    }`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {officials.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Urzędnicy
              </h3>
              <ul className="flex flex-col gap-1">
                {officials.map((o) => (
                  <li
                    key={o.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-0.5 ${
                      speakingIds.has(o.id)
                        ? "bg-emerald-50 dark:bg-emerald-950/30"
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={speakerFilter.has(o.id)}
                      onChange={() => toggleSpeakerFilter(o.id)}
                      className="shrink-0"
                    />
                    <button
                      disabled={selected.size === 0 || isPending}
                      onClick={() => assignTo({ type: "official", id: o.id })}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${
                        speakingIds.has(o.id) ? "font-semibold" : ""
                      }`}
                    >
                      {o.full_name}
                      <span className="text-zinc-400"> — {o.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
