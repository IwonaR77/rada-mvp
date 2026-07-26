"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import ReactPlayer from "react-player";
import { assignSegments } from "@/app/sesje/[id]/actions";

type Segment = {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
  confirmed_councilor_id: string | null;
  confirmed_official_id: string | null;
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

export function SessionPlayer({
  meetingId,
  videoUrl,
  segments,
  councilors,
  officials,
  isAdmin,
  initialSeek,
}: {
  meetingId: string;
  videoUrl: string;
  segments: Segment[];
  councilors: Person[];
  officials: { id: string; full_name: string; role: string }[];
  isAdmin: boolean;
  initialSeek?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);
  const hasAppliedInitialSeek = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unassigned">("all");
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeSegment = segments.find(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  );

  const isUnassigned = (s: Segment) =>
    !s.confirmed_councilor_id && !s.confirmed_official_id;
  const unassignedCount = segments.filter(isUnassigned).length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSegments = segments
    .filter((s) => (filter === "unassigned" ? isUnassigned(s) : true))
    .filter((s) =>
      normalizedQuery ? s.text.toLowerCase().includes(normalizedQuery) : true
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

  function assignTo(target: { type: "councilor" | "official"; id: string }) {
    startTransition(async () => {
      await assignSegments(meetingId, Array.from(selected), target);
      setSelected(new Set());
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
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
        </div>

        <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-200 p-2 dark:border-zinc-800">
          {visibleSegments.length === 0 && (
            <li className="p-4 text-center text-zinc-500">
              {normalizedQuery
                ? `Brak wyników dla „${query}".`
                : filter === "unassigned"
                  ? "Wszystkie segmenty mają przypisanego mówcę."
                  : "Brak segmentów dla tej sesji."}
            </li>
          )}
          {visibleSegments.map((s) => {
            const isActive = activeSegment?.id === s.id;
            const assignedId = s.confirmed_councilor_id ?? s.confirmed_official_id;
            return (
              <li
                key={s.id}
                ref={isActive ? activeRowRef : undefined}
                className={`flex items-start gap-2 rounded-xl px-2 py-2 transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : !assignedId
                      ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {isAdmin && (
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
                        isActive ? "text-zinc-300" : "text-zinc-400"
                      }`}
                    >
                      {peopleById.get(assignedId) ?? "?"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {isAdmin && (
        <div className="flex w-full flex-col gap-4 lg:w-64">
          <p className="text-sm text-zinc-500">
            Zaznaczono: {selected.size} segment(ów)
          </p>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Radni
            </h3>
            <ul className="flex flex-col gap-1">
              {councilors.map((c) => (
                <li key={c.id}>
                  <button
                    disabled={selected.size === 0 || isPending}
                    onClick={() => assignTo({ type: "councilor", id: c.id })}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
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
                  <li key={o.id}>
                    <button
                      disabled={selected.size === 0 || isPending}
                      onClick={() => assignTo({ type: "official", id: o.id })}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
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
