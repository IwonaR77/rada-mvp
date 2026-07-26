import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpeakingHeatmap } from "@/components/speaking-heatmap";
import { FavoriteCouncilButton } from "@/components/favorite-council-button";

type CouncilorStat = {
  id: string;
  fullName: string;
  party: string | null;
  totalSeconds: number;
};

const STATUS_DOT_CLASS: Record<string, string> = {
  "nie rozpisana": "bg-zinc-300 dark:bg-zinc-700",
  "w trakcie": "bg-amber-400",
  rozpisana: "bg-emerald-500",
};

function formatDuration(totalSeconds: number) {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours} godz. ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];

function avatarColor(fullName: string) {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ fullName }: { fullName: string }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(fullName)}`}
    >
      {getInitials(fullName)}
    </span>
  );
}

export default async function CouncilDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ councilId: string }>;
  searchParams: Promise<{ kadencja?: string }>;
}) {
  const { councilId } = await params;
  const { kadencja } = await searchParams;
  const supabase = await createClient();

  const { data: council } = await supabase
    .from("council")
    .select("id, name, city:city_id(name)")
    .eq("id", councilId)
    .maybeSingle();

  if (!council) notFound();

  const { data: terms } = await supabase
    .from("term")
    .select("id, label, start_date, end_date")
    .eq("council_id", councilId)
    .order("start_date", { ascending: false });

  const validTermIds = new Set((terms ?? []).map((t) => t.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let savedTermId: string | null = null;
  let isFavoriteCouncil = false;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("last_viewed_term_id, favorite_council_id")
      .eq("id", user.id)
      .maybeSingle();
    savedTermId = appUser?.last_viewed_term_id ?? null;
    isFavoriteCouncil = appUser?.favorite_council_id === councilId;
  }

  const selectedTermId =
    (kadencja && validTermIds.has(kadencja) ? kadencja : null) ??
    (savedTermId && validTermIds.has(savedTermId) ? savedTermId : null) ??
    terms?.[0]?.id ??
    null;

  if (user && selectedTermId && selectedTermId !== savedTermId) {
    await supabase
      .from("app_user")
      .update({ last_viewed_term_id: selectedTermId })
      .eq("id", user.id);
  }

  const selectedTerm = (terms ?? []).find((t) => t.id === selectedTermId);

  let stats: CouncilorStat[] = [];
  let meetings: {
    id: string;
    date: string;
    title: string | null;
    video_url: string | null;
    video_downloaded: boolean;
    transcript_status: string;
  }[] = [];
  let councilors: { id: string; fullName: string }[] = [];
  let heatmapMeetings: { id: string; date: string; title: string | null }[] =
    [];
  const heatmapMatrix: Record<string, Record<string, number>> = {};

  if (selectedTermId) {
    const [{ data: roster }, { data: segments }, { data: meetingRows }] =
      await Promise.all([
        supabase
          .from("councilor_term")
          .select("party, councilor:councilor_id(id, full_name)")
          .eq("term_id", selectedTermId),
        supabase
          .from("segment")
          .select(
            "confirmed_councilor_id, meeting_id, start_time, end_time, meeting:meeting_id!inner(term_id)"
          )
          .eq("status", "finalized")
          .eq("meeting.term_id", selectedTermId),
        supabase
          .from("meeting")
          .select(
            "id, date, title, video_url, video_downloaded, transcript_status"
          )
          .eq("term_id", selectedTermId)
          .order("date", { ascending: false }),
      ]);

    meetings = meetingRows ?? [];
    councilors = (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({ id: r.councilor!.id, fullName: r.councilor!.full_name }));

    const totals = new Map<string, number>();
    const meetingIdsWithData = new Set<string>();
    for (const s of segments ?? []) {
      if (!s.confirmed_councilor_id) continue;
      const duration = Number(s.end_time) - Number(s.start_time);
      totals.set(
        s.confirmed_councilor_id,
        (totals.get(s.confirmed_councilor_id) ?? 0) + duration
      );
      meetingIdsWithData.add(s.meeting_id);
      heatmapMatrix[s.confirmed_councilor_id] ??= {};
      heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] =
        (heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] ?? 0) +
        duration;
    }
    heatmapMeetings = (meetingRows ?? [])
      .filter((m) => meetingIdsWithData.has(m.id))
      .map((m) => ({ id: m.id, date: m.date, title: m.title }));

    stats = (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({
        id: r.councilor!.id,
        fullName: r.councilor!.full_name,
        party: r.party,
        totalSeconds: totals.get(r.councilor!.id) ?? 0,
      }));
  }

  const { data: officials } = await supabase
    .from("official")
    .select("id, full_name, role");

  const mostActive = [...stats]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 3);
  const mostSilent = [...stats]
    .sort((a, b) => a.totalSeconds - b.totalSeconds)
    .slice(0, 3);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Mapa
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {council.name}
          </h1>
          {user && (
            <FavoriteCouncilButton
              councilId={council.id}
              initialIsFavorite={isFavoriteCouncil}
            />
          )}
        </div>
        <p className="text-zinc-500">{council.city?.name}</p>
      </div>

      {!terms || terms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Brak zarejestrowanych kadencji dla tej rady.
        </p>
      ) : (
        <>
          {terms.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {terms.map((t) => (
                <Link
                  key={t.id}
                  href={`/rada/${council.id}?kadencja=${t.id}`}
                  prefetch={false}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    t.id === selectedTermId
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.label ?? formatDate(t.start_date)}
                </Link>
              ))}
            </div>
          )}

          {selectedTerm && (
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedTerm.label ?? "Kadencja"}
              </h2>
              <p className="text-sm text-zinc-500">
                {formatDate(selectedTerm.start_date)}
                {selectedTerm.end_date
                  ? ` – ${formatDate(selectedTerm.end_date)}`
                  : " – obecnie"}
              </p>
            </div>
          )}

          <section>
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Oś czasu sesji
            </h3>
            {meetings.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Brak zarejestrowanych sesji w tej kadencji.
              </p>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div className="relative flex min-w-max items-start gap-7 px-2 pt-2">
                  <div className="absolute left-2 right-2 top-[9px] h-px bg-zinc-200 dark:bg-zinc-800" />
                  {meetings.map((m) => {
                    const hasContent = Boolean(m.video_url);
                    const status = m.transcript_status ?? "nie rozpisana";
                    const marker = (
                      <div className="flex flex-col items-center gap-2">
                        <span
                          className={`relative z-10 h-3.5 w-3.5 rounded-full ring-4 ring-white dark:ring-black ${STATUS_DOT_CLASS[status] ?? STATUS_DOT_CLASS["nie rozpisana"]}`}
                        />
                        <span className="whitespace-nowrap text-xs text-zinc-500">
                          {formatShortDate(m.date)}
                        </span>
                      </div>
                    );
                    return hasContent ? (
                      <Link
                        key={m.id}
                        href={`/sesje/${m.id}`}
                        prefetch={false}
                        title={m.title ?? undefined}
                        className="shrink-0 hover:opacity-70"
                      >
                        {marker}
                      </Link>
                    ) : (
                      <div
                        key={m.id}
                        title={m.title ?? undefined}
                        className="shrink-0"
                      >
                        {marker}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
              Aktywność na sesjach
            </h3>
            <SpeakingHeatmap
              councilors={councilors}
              meetings={heatmapMeetings}
              matrix={heatmapMatrix}
            />
          </section>

          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                Radni ({councilors.length})
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {councilors.map((c) => c.fullName).join(", ") || "—"}
              </p>
            </div>
            {officials && officials.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Kluczowi urzędnicy
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {officials.map((o) => `${o.full_name} (${o.role})`).join(", ")}
                </p>
              </div>
            )}
          </section>

          {stats.every((c) => c.totalSeconds === 0) ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
              Jeszcze brak danych z sesji dla tej kadencji. Ranking pojawi się,
              gdy zostaną wgrane transkrypcje i sesje.
            </p>
          ) : (
            <div className="grid gap-8 sm:grid-cols-2">
              <section>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Najaktywniejsi
                </h3>
                <ol className="flex flex-col gap-2">
                  {mostActive.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                    >
                      <Avatar fullName={c.fullName} />
                      <span className="flex-1">{c.fullName}</span>
                      <span className="text-sm text-zinc-500">
                        {formatDuration(c.totalSeconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
                  Najcichsi
                </h3>
                <ol className="flex flex-col gap-2">
                  {mostSilent.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                    >
                      <Avatar fullName={c.fullName} />
                      <span className="flex-1">{c.fullName}</span>
                      <span className="text-sm text-zinc-500">
                        {formatDuration(c.totalSeconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
