import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ApproveMatterButton } from "@/components/approve-matter-button";

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

type Matter = {
  id: string;
  title: string;
  status: string;
  notes: string | null;
  council_id: string;
  thread_id: string | null;
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

type Thread = { id: string; title: string; description: string | null };

// Groups matters by thread, preserving each thread's first-appearance order
// (matters arrive pre-sorted by created_at); matters without a thread are
// kept in their own trailing, header-less group rather than forced under
// a fake "inne" bucket — most matters won't have a thread, and that's fine.
function groupByThread(matters: Matter[], threadsById: Map<string, Thread>) {
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
function ThreadGroup({
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
    </li>
  );
}

export default async function SprawyPage({
  searchParams,
}: {
  searchParams: Promise<{ councilId?: string }>;
}) {
  const { councilId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase
    .from("matter")
    .select(
      `id, title, status, notes, council_id, thread_id,
       matter_participant(role, councilor:councilor_id(id, full_name)),
       matter_reference(id, note, meeting:meeting_id(id, date), interpellation:interpellation_id(id, title, pdf_url))`
    )
    .order("created_at", { ascending: true });
  if (councilId) query = query.eq("council_id", councilId);

  let threadsQuery = supabase
    .from("matter_thread")
    .select("id, title, description");
  if (councilId) threadsQuery = threadsQuery.eq("council_id", councilId);

  const [{ data: matters }, { data: council }, { data: threads }] =
    await Promise.all([
      query,
      councilId
        ? supabase.from("council").select("id, name").eq("id", councilId).maybeSingle()
        : Promise.resolve({ data: null }),
      threadsQuery,
    ]);

  const rows = (matters ?? []) as unknown as Matter[];
  const threadsById = new Map((threads ?? []).map((t) => [t.id, t as Thread]));

  const canApproveByCouncil = new Map<string, boolean>();
  if (user) {
    const distinctCouncilIds = [...new Set(rows.map((m) => m.council_id))];
    const results = await Promise.all(
      distinctCouncilIds.map((councilId) =>
        supabase.rpc("user_has_permission", {
          uid: user.id,
          perm: "finalize_vote",
          target_council_id: councilId,
        })
      )
    );
    distinctCouncilIds.forEach((councilId, i) => {
      canApproveByCouncil.set(councilId, Boolean(results[i].data));
    });
  }

  const approved = rows.filter((m) => m.status === "approved");
  const proposed = rows.filter((m) => m.status === "proposed");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12">
      <div>
        {council && (
          <Link
            href={`/rada/${council.id}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            ← {council.name}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Sprawy{council ? ` — ${council.name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Wątki i sprawy powracające na sesjach i w interpelacjach — niezależnie
          od tego, ilu radnych je prowadzi i jak długo trwają.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Zatwierdzone ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak zatwierdzonych spraw.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groupByThread(approved, threadsById).map((group, i) => (
              <ThreadGroup
                key={group.thread?.id ?? `untitled-${i}`}
                thread={group.thread}
                matters={group.matters}
                canApproveByCouncil={canApproveByCouncil}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Oczekujące na akceptację ({proposed.length})
        </h2>
        {proposed.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak spraw oczekujących na akceptację.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groupByThread(proposed, threadsById).map((group, i) => (
              <ThreadGroup
                key={group.thread?.id ?? `untitled-${i}`}
                thread={group.thread}
                matters={group.matters}
                canApproveByCouncil={canApproveByCouncil}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
