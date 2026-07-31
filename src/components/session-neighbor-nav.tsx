"use client";

import { useEffect, useRef } from "react";
import { SessionTimelinePill } from "@/components/session-timeline-pill";

type NeighborMeeting = {
  id: string;
  date: string;
  hasVideo: boolean;
  hasTranscript: boolean;
  number: number;
  progress: number | undefined;
  hasSummary: boolean;
};

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
        const tooltipParts = [m.date];
        if (m.progress !== undefined) {
          tooltipParts.push(`otagowane: ${Math.round(m.progress * 100)}%`);
        }
        if (m.hasSummary) tooltipParts.push("ma podsumowanie");
        if (!m.hasVideo) tooltipParts.push("brak nagrania/transkrypcji");

        return (
          <SessionTimelinePill
            key={m.id}
            ref={isCurrent ? activeRef : undefined}
            meeting={m}
            isCurrent={isCurrent}
            title={tooltipParts.join(" — ")}
          />
        );
      })}
    </nav>
  );
}
