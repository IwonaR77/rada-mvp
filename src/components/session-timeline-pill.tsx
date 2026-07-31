import { forwardRef } from "react";
import Link from "next/link";

export type TimelineMeeting = {
  id: string;
  date: string;
  hasVideo: boolean;
  hasTranscript: boolean;
  number: number;
  // Tagging progress (finalized/total segments), 0–1. Undefined when the
  // session has no transcript yet (progress isn't meaningful before
  // segments exist) — the pill's border then stays its plain gray.
  progress: number | undefined;
  hasSummary: boolean;
};

function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

// Tints the pill's own border proportionally green as segments get assigned
// to speakers, instead of adding any separate ring/badge — a conic-gradient
// ring masked down to just the border's width, with border-radius: inherit
// so it traces this pill's shape exactly. Transparent for the un-filled
// portion, so the plain gray border underneath still shows through
// unchanged where progress hasn't reached.
function ProgressBorder({ progress }: { progress: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] p-px"
      style={{
        background: `conic-gradient(#10b981 ${progress * 100}%, transparent 0)`,
        WebkitMask:
          "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }}
    />
  );
}

// Shared by the /sesje/[id] neighbor nav and the /rada/[councilId] timeline
// so a session's border, progress and summary indicator read identically in
// both places.
export const SessionTimelinePill = forwardRef<
  HTMLAnchorElement,
  {
    meeting: TimelineMeeting;
    isCurrent?: boolean;
    dimmed?: boolean;
    emphasized?: boolean;
    title?: string;
  }
>(function SessionTimelinePill(
  { meeting, isCurrent = false, dimmed = false, emphasized = false, title },
  ref
) {
  const { id, date, hasVideo, hasTranscript, number, progress, hasSummary } =
    meeting;

  const className = `relative flex w-16 shrink-0 flex-col items-center rounded-2xl px-2.5 py-1 leading-tight transition-colors ${
    dimmed ? "opacity-25" : ""
  } ${
    emphasized
      ? "outline outline-2 outline-offset-2 outline-zinc-900 dark:outline-zinc-100"
      : ""
  } ${
    isCurrent
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : hasVideo
        ? `border ${hasTranscript ? "border-solid" : "border-dotted"} border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800`
        : "cursor-default border border-dashed border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700"
  }`;

  const dateClassName = `whitespace-nowrap text-[10px] ${
    isCurrent
      ? "text-white/70 dark:text-zinc-900/60"
      : hasVideo
        ? "text-zinc-400 dark:text-zinc-500"
        : "text-zinc-300 dark:text-zinc-700"
  }`;

  // The current pill is already max-contrast (white on dark, or vice
  // versa) — the summary highlight only means something against the
  // muted default number color the other pills use.
  const numberClassName =
    !isCurrent && hasSummary
      ? "font-semibold text-zinc-900 dark:text-zinc-100"
      : undefined;

  const showProgress =
    !isCurrent && hasVideo && progress !== undefined && progress > 0;

  const inner = (
    <>
      {showProgress && <ProgressBorder progress={progress!} />}
      <span className={numberClassName}>{number}</span>
      <span className={dateClassName}>{formatShortDate(date)}</span>
    </>
  );

  if (!hasVideo) {
    return (
      <span title={title} className={className}>
        {inner}
      </span>
    );
  }

  return (
    <Link
      ref={ref}
      href={`/sesje/${id}`}
      prefetch={false}
      title={title}
      className={className}
    >
      {inner}
    </Link>
  );
});
