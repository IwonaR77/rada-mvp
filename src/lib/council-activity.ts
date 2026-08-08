import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type CouncilorStat = {
  id: string;
  fullName: string;
  party: string | null;
  totalSeconds: number;
};

export type SpeakingActivity = {
  councilors: { id: string; fullName: string }[];
  heatmapMeetings: { id: string; date: string; title: string | null }[];
  heatmapMatrix: Record<string, Record<string, number>>;
  heatmapExtraRows: { id: string; fullName: string }[];
  stats: CouncilorStat[];
};

const EMPTY_ACTIVITY: SpeakingActivity = {
  councilors: [],
  heatmapMeetings: [],
  heatmapMatrix: {},
  heatmapExtraRows: [],
  stats: [],
};

// Per-term speaking-time aggregation shared by the council hub (latest term
// only, no switcher) and /sesje (full term switching) — same computation,
// same heatmap shape, so it shouldn't drift into two implementations.
export async function getSpeakingActivity(
  supabase: SupabaseClient,
  termId: string,
  officials: { id: string; full_name: string; role: string }[]
): Promise<SpeakingActivity> {
  const [{ data: roster }, segments, { data: meetingRows }] = await Promise.all([
    supabase
      .from("councilor_term")
      .select("party, councilor:councilor_id(id, full_name)")
      .eq("term_id", termId),
    // See the same note in /sesje/[id]/page.tsx — a single .range() request
    // can't exceed PostgREST's server-side max-rows cap no matter how wide
    // a range is asked for; paginate instead.
    fetchAllRows<{
      confirmed_councilor_id: string | null;
      confirmed_official_id: string | null;
      meeting_id: string;
      start_time: number;
      end_time: number;
    }>((from, to) =>
      supabase
        .from("segment")
        .select(
          "confirmed_councilor_id, confirmed_official_id, meeting_id, start_time, end_time, meeting:meeting_id!inner(term_id)"
        )
        .eq("status", "finalized")
        .eq("meeting.term_id", termId)
        .range(from, to)
    ),
    supabase
      .from("meeting")
      .select("id, date, title, transcript_status")
      .eq("term_id", termId)
      // Komisja meetings share this table but aren't "sesje" — currently
      // excluded from the heatmap anyway by the transcript_status filter
      // below (nothing sets 'rozpisana' on a komisja meeting today), but
      // that's an indirect invariant, not an enforced one — filter here
      // too rather than rely on it staying true.
      .neq("meeting_type", "komisja")
      .order("date", { ascending: false }),
  ]);

  if (!roster) return EMPTY_ACTIVITY;

  const councilors = roster
    .filter((r) => r.councilor)
    .map((r) => ({ id: r.councilor!.id, fullName: r.councilor!.full_name }));

  const heatmapMatrix: Record<string, Record<string, number>> = {};
  const totals = new Map<string, number>();
  for (const s of segments) {
    if (!s.confirmed_councilor_id) continue;
    const duration = Number(s.end_time) - Number(s.start_time);
    totals.set(
      s.confirmed_councilor_id,
      (totals.get(s.confirmed_councilor_id) ?? 0) + duration
    );
    heatmapMatrix[s.confirmed_councilor_id] ??= {};
    heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] =
      (heatmapMatrix[s.confirmed_councilor_id][s.meeting_id] ?? 0) + duration;
  }

  // Burmistrz and his deputy get their own heatmap rows (they're frequent,
  // named participants); every other official (skarbnik, sekretarz,
  // naczelnicy, urzędnicy odpowiadający na interpelacje, ...) is folded
  // into one combined "Pozostali urzędnicy" row so the heatmap doesn't
  // grow a long tail of near-empty rows for people who spoke once or twice.
  const burmistrz = officials.find((o) =>
    o.role.toLowerCase().startsWith("burmistrz")
  );
  const zastepcaBurmistrza = officials.find((o) =>
    o.role.toLowerCase().startsWith("zastępca burmistrza")
  );
  const POZOSTALI_URZEDNICY_ID = "__pozostali_urzednicy__";
  const pozostaliIds = new Set(
    officials
      .filter((o) => o.id !== burmistrz?.id && o.id !== zastepcaBurmistrza?.id)
      .map((o) => o.id)
  );
  let pozostaliHasData = false;

  for (const s of segments) {
    if (!s.confirmed_official_id) continue;
    const duration = Number(s.end_time) - Number(s.start_time);
    const key =
      s.confirmed_official_id === burmistrz?.id
        ? burmistrz.id
        : s.confirmed_official_id === zastepcaBurmistrza?.id
          ? zastepcaBurmistrza.id
          : pozostaliIds.has(s.confirmed_official_id)
            ? POZOSTALI_URZEDNICY_ID
            : null;
    if (!key) continue;
    if (key === POZOSTALI_URZEDNICY_ID) pozostaliHasData = true;
    heatmapMatrix[key] ??= {};
    heatmapMatrix[key][s.meeting_id] = (heatmapMatrix[key][s.meeting_id] ?? 0) + duration;
  }

  const heatmapExtraRows = [
    ...(burmistrz ? [{ id: burmistrz.id, fullName: burmistrz.full_name }] : []),
    ...(zastepcaBurmistrza
      ? [{ id: zastepcaBurmistrza.id, fullName: zastepcaBurmistrza.full_name }]
      : []),
    ...(pozostaliHasData
      ? [{ id: POZOSTALI_URZEDNICY_ID, fullName: "Pozostali urzędnicy" }]
      : []),
  ];

  // A session shows up as a column as soon as its transcript is imported
  // (transcript_status "rozpisana"), even before anyone's been tagged — it
  // just renders fully gray until tagging starts filling it in.
  const heatmapMeetings = (meetingRows ?? [])
    .filter((m) => m.transcript_status === "rozpisana")
    .map((m) => ({ id: m.id, date: m.date, title: m.title }));

  const stats = roster
    .filter((r) => r.councilor)
    .map((r) => ({
      id: r.councilor!.id,
      fullName: r.councilor!.full_name,
      party: r.party,
      totalSeconds: totals.get(r.councilor!.id) ?? 0,
    }));

  return { councilors, heatmapMeetings, heatmapMatrix, heatmapExtraRows, stats };
}
