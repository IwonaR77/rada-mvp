"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

type NeighborMeeting = {
  id: string;
  date: string;
  hasVideo: boolean;
  number: number;
};

// Same short format used on the /rada/[councilId] timeline (e.g. "16 lip"),
// duplicated locally per this codebase's existing convention rather than a
// shared util — so a session's number here always reads next to the same
// date shorthand the timeline showed before you clicked into it.
function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

export function SessionNeighborNav({
  meetings,
  currentId,
}: {
  meetings: NeighborMeeting[]; // newest first (leftmost)
  currentId: string;
}) {
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "instant",
    });
  }, []);

  if (meetings.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1.5 overflow-x-auto text-sm">
      {meetings.map((m) => {
        const isCurrent = m.id === currentId;
        const className = `flex shrink-0 flex-col items-center rounded-2xl px-2.5 py-1 leading-tight transition-colors ${
          isCurrent
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : m.hasVideo
              ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              : "cursor-default border border-dashed border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
        }`;
        const dateClassName = `text-[10px] ${
          isCurrent
            ? "text-white/70 dark:text-zinc-900/60"
            : m.hasVideo
              ? "text-zinc-400 dark:text-zinc-500"
              : "text-zinc-300 dark:text-zinc-700"
        }`;

        if (!m.hasVideo) {
          return (
            <span
              key={m.id}
              title={`${m.date} — brak nagrania/transkrypcji`}
              className={className}
            >
              <span>{m.number}</span>
              <span className={dateClassName}>{formatShortDate(m.date)}</span>
            </span>
          );
        }

        return (
          <Link
            key={m.id}
            ref={isCurrent ? activeRef : undefined}
            href={`/sesje/${m.id}`}
            prefetch={false}
            title={m.date}
            className={className}
          >
            <span>{m.number}</span>
            <span className={dateClassName}>{formatShortDate(m.date)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
