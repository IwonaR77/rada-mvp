"use client";

import { useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";

type Segment = {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
};

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function SessionPlayer({
  videoUrl,
  segments,
}: {
  videoUrl: string;
  segments: Segment[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const activeSegment = segments.find(
    (s) => currentTime >= s.start_time && currentTime < s.end_time
  );

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

  return (
    <div className="flex flex-col gap-6">
      <ReactPlayer
        ref={videoRef}
        src={videoUrl}
        controls
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        style={{ width: "100%", height: "auto", aspectRatio: "16/9" }}
      />

      <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-200 p-2 dark:border-zinc-800">
        {segments.length === 0 && (
          <li className="p-4 text-center text-zinc-500">
            Brak segmentów dla tej sesji.
          </li>
        )}
        {segments.map((s) => {
          const isActive = activeSegment?.id === s.id;
          return (
            <li key={s.id} ref={isActive ? activeRowRef : undefined}>
              <button
                onClick={() => handleSeek(s.start_time)}
                className={`flex w-full gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <span
                  className={`shrink-0 font-mono ${
                    isActive ? "" : "text-zinc-400"
                  }`}
                >
                  {formatTime(s.start_time)}
                </span>
                <span>{s.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
