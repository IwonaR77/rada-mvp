import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadElection, type ElectionData } from "@/lib/election-data";
import { assignCommitteeSlots } from "@/lib/election-committee";
import { spearman } from "@/lib/correlation";

/** Jeden radny jako punkt kwadrantu głosy/czas mówienia. */
export type VotesSpeakingPoint = {
  councilorId: string;
  fullName: string;
  committeeCode: string | null;
  /** Palette slot for the committee, or null when it has none. */
  slot: number | null;
  votes: number;
  seconds: number;
  role: string | null;
};

export type VotesSpeakingData = {
  points: VotesSpeakingPoint[];
  correlation: { all: number; withoutOfficers: number };
};

type RosterEntry = { id: string; fullName: string; role: string | null };

type SpeakingRow = {
  is_councilor_flag: boolean;
  speaker_id: string;
  total_seconds: number;
};

/**
 * Zestawia wynik wyborczy radnego z jego łącznym czasem mówienia na sesjach.
 *
 * Osobno od loadera, bo strona /glosy ma skład i wynik wyborów już wczytane
 * na potrzeby macierzy i tabel — nie ma powodu pobierać po raz drugi listy
 * kandydatów, która potrafi mieć kilkaset pozycji.
 */
export function buildVotesVsSpeaking(
  roster: RosterEntry[],
  election: ElectionData,
  speakingRows: SpeakingRow[] | null
): VotesSpeakingData {
  // Głosy bierzemy z kandydatur (także tych przegranych), bo radni wchodzący
  // na wakat nie figurują w tabeli zwycięzców, a na sesjach mówią jak wszyscy.
  const votesByCouncilor = new Map<string, { votes: number; code: string }>();
  for (const c of election.candidates) {
    if (c.councilorId) {
      votesByCouncilor.set(c.councilorId, { votes: c.votes, code: c.committeeCode });
    }
  }

  const seconds = new Map<string, number>();
  for (const r of speakingRows ?? []) {
    if (!r.is_councilor_flag || !r.speaker_id) continue;
    seconds.set(r.speaker_id, (seconds.get(r.speaker_id) ?? 0) + Number(r.total_seconds));
  }

  const slots = assignCommitteeSlots(
    election.committees.map((c) => ({ code: c.code, ballotOrder: c.listNumber }))
  );

  const points = roster.flatMap<VotesSpeakingPoint>((c) => {
    const v = votesByCouncilor.get(c.id);
    return v
      ? [
          {
            councilorId: c.id,
            fullName: c.fullName,
            committeeCode: v.code,
            slot: slots.get(v.code) ?? null,
            votes: v.votes,
            seconds: seconds.get(c.id) ?? 0,
            role: c.role,
          },
        ]
      : [];
  });

  const withoutOfficers = points.filter((p) => !p.role);

  return {
    points,
    correlation: {
      all: spearman(
        points.map((p) => p.votes),
        points.map((p) => p.seconds)
      ),
      withoutOfficers: spearman(
        withoutOfficers.map((p) => p.votes),
        withoutOfficers.map((p) => p.seconds)
      ),
    },
  };
}

/**
 * Wczytuje wszystko, czego kwadrant potrzebuje, dla podanej kadencji.
 *
 * Zwraca `null`, gdy kadencja nie ma zaimportowanych wyborów — to normalny
 * przypadek (na razie tylko Grójec je ma), więc każdy wywołujący musi umieć
 * się bez kwadrantu obejść.
 */
export async function loadVotesVsSpeaking(
  supabase: SupabaseClient<Database>,
  termId: string
): Promise<VotesSpeakingData | null> {
  const [{ data: roster }, election, { data: speakingRows }] = await Promise.all([
    supabase
      .from("councilor_term")
      .select("role, councilor:councilor_id(id, full_name)")
      .eq("term_id", termId),
    loadElection(supabase, termId),
    supabase.rpc("term_speaking_blocks", { p_term_id: termId }),
  ]);

  if (!election) return null;

  return buildVotesVsSpeaking(
    (roster ?? [])
      .filter((r) => r.councilor)
      .map((r) => ({
        id: r.councilor!.id,
        fullName: r.councilor!.full_name,
        role: r.role ?? null,
      })),
    election,
    speakingRows
  );
}
