import Link from "next/link";
import { ApproveMatterButton } from "@/components/approve-matter-button";
import { MatterTagEditor } from "@/components/matter-tag-editor";

const ROLE_LABEL: Record<string, string> = {
  inicjator: "Inicjator",
  poparcie: "Poparcie",
  sprzeciw: "Sprzeciw",
  zaangażowany: "Zaangażowany",
};

const ROLE_CLASS: Record<string, string> = {
  inicjator: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  poparcie:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  sprzeciw: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  zaangażowany: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export type Matter = {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  council_id: string;
  thread_id: string | null;
  matter_tag: { tag: string }[];
  matter_participant: {
    role: string;
    councilor: { id: string; full_name: string } | null;
  }[];
  matter_reference: {
    id: string;
    note: string | null;
    meeting: { id: string; date: string } | null;
    interpellation: { id: string; title: string; pdf_url: string | null } | null;
  }[];
};

export type Thread = { id: string; title: string; description: string | null };

export function collectTags(matters: Matter[]): string[] {
  return [...new Set(matters.flatMap((m) => m.matter_tag.map((t) => t.tag)))].sort(
    (a, b) => a.localeCompare(b, "pl")
  );
}

export function filterMattersByTag(matters: Matter[], tag: string | null): Matter[] {
  if (!tag) return matters;
  return matters.filter((m) => m.matter_tag.some((t) => t.tag === tag));
}

// Groups matters by thread, preserving each thread's first-appearance order
// (matters arrive pre-sorted by created_at); matters without a thread are
// kept in their own trailing, header-less group rather than forced under
// a fake "inne" bucket — most matters won't have a thread, and that's fine.
export function groupByThread(matters: Matter[], threadsById: Map<string, Thread>) {
  const groups: { thread: Thread | null; matters: Matter[] }[] = [];
  const indexByThreadId = new Map<string, number>();
  const untitled: Matter[] = [];

  for (const m of matters) {
    if (!m.thread_id) {
      untitled.push(m);
      continue;
    }
    const thread = threadsById.get(m.thread_id) ?? null;
    if (!thread) {
      untitled.push(m);
      continue;
    }
    let idx = indexByThreadId.get(thread.id);
    if (idx === undefined) {
      idx = groups.length;
      indexByThreadId.set(thread.id, idx);
      groups.push({ thread, matters: [] });
    }
    groups[idx].matters.push(m);
  }
  if (untitled.length > 0) groups.push({ thread: null, matters: untitled });
  return groups;
}

// Native <details>/<summary> — no client component or JS state needed for
// a simple expand/collapse, and it's accessible/keyboard-operable for free.
// The chevron rotates via the `group-open:` variant, which Tailwind maps to
// the browser-native `details[open]` state.
export function ThreadGroup({
  thread,
  matters,
  canApproveByCouncil,
}: {
  thread: Thread | null;
  matters: Matter[];
  canApproveByCouncil: Map<string, boolean>;
}) {
  return (
    <details className="group">
      <summary className="mb-2 flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-90"
        >
          <path d="M7.05 4.55a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06L11.44 10 7.05 5.61a.75.75 0 0 1 0-1.06Z" />
        </svg>
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            {thread ? thread.title : "Pozostałe sprawy"} ({matters.length})
          </h3>
          {thread?.description && (
            <p className="mt-0.5 text-xs text-zinc-500">{thread.description}</p>
          )}
        </div>
      </summary>
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {matters.map((m) => (
          <MatterCard
            key={m.id}
            matter={m}
            canApprove={canApproveByCouncil.get(m.council_id) ?? false}
          />
        ))}
      </ul>
    </details>
  );
}

function MatterCard({
  matter,
  canApprove,
}: {
  matter: Matter;
  canApprove: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {matter.title}
        </h3>
        {matter.status === "proposed" && canApprove && (
          <ApproveMatterButton matterId={matter.id} />
        )}
      </div>

      {matter.notes && (
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {matter.notes}
        </p>
      )}

      {matter.matter_participant.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {matter.matter_participant.map((p, i) =>
            p.councilor ? (
              <Link
                key={p.councilor.id + i}
                href={`/radny/${p.councilor.id}`}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium hover:underline ${ROLE_CLASS[p.role] ?? ROLE_CLASS.zaangażowany}`}
              >
                {p.councilor.full_name}
                <span className="ml-1 opacity-70">
                  ({ROLE_LABEL[p.role] ?? p.role})
                </span>
              </Link>
            ) : null
          )}
        </div>
      )}

      {matter.matter_reference.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-zinc-500">
          {matter.matter_reference.map((r) => (
            <li key={r.id}>
              {r.meeting && (
                <Link href={`/sesje/${r.meeting.id}`} className="hover:underline">
                  Sesja {formatDate(r.meeting.date)}
                </Link>
              )}
              {r.interpellation &&
                (r.interpellation.pdf_url ? (
                  <a
                    href={r.interpellation.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {r.interpellation.title}
                  </a>
                ) : (
                  <span>{r.interpellation.title}</span>
                ))}
              {r.note && <span className="text-zinc-400"> — {r.note}</span>}
            </li>
          ))}
        </ul>
      )}

      <MatterTagEditor
        matterId={matter.id}
        tags={matter.matter_tag.map((t) => t.tag)}
        editable={canApprove}
      />
    </li>
  );
}
