import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { SimCandidate } from "@/lib/electoral-systems";

export type ElectionCommittee = {
  code: string;
  name: string;
  shortName: string;
  listNumber: number;
  votes: number;
  seats: number;
};

export type ElectionData = {
  heldOn: string;
  seats: number;
  totalVotes: number;
  districts: { number: number; seats: number; validVotes: number }[];
  committees: ElectionCommittee[];
  candidates: SimCandidate[];
  /** Votes and seats per committee per district: `${code}|${districtNumber}`. */
  byDistrict: Map<string, { votes: number; seats: number }>;
  /**
   * Candidate ids that actually won a seat on election night. The baseline for
   * every simulation — deliberately the election result, not today's roster,
   * which also contains councilors who entered later on vacated mandates.
   */
  actualElectedIds: Set<string>;
};

/**
 * Loads a term's election result, or null when it was never imported.
 *
 * Councils without an imported election are the normal case, not an error —
 * only the first session of a term reads the result out loud, PKW's per-council
 * dataset differs by council size, and so far only Grójec has been imported.
 * Every caller must render fine without this.
 */
export async function loadElection(
  supabase: SupabaseClient<Database>,
  termId: string
): Promise<ElectionData | null> {
  const { data: election } = await supabase
    .from("election")
    .select("id, held_on, seats")
    .eq("term_id", termId)
    .maybeSingle();
  if (!election) return null;

  const [{ data: districts }, { data: committees }, { data: candidates }] = await Promise.all([
    supabase
      .from("election_district")
      .select("id, number, seats, valid_votes")
      .eq("election_id", election.id)
      .order("number"),
    supabase
      .from("election_committee")
      .select("id, code, name, short_name, list_number")
      .eq("election_id", election.id)
      .order("list_number"),
    // Explicit range: an unbounded select silently caps at ~1000 rows, and a
    // truncated candidate list would quietly produce a wrong seat allocation
    // rather than an error.
    supabase
      .from("election_candidate")
      .select("id, district_id, committee_id, list_position, full_name, votes, won_mandate, councilor_id")
      .eq("election_id", election.id)
      .range(0, 4999),
  ]);

  const districtNumber = new Map((districts ?? []).map((d) => [d.id, d.number]));
  const committeeCode = new Map((committees ?? []).map((c) => [c.id, c.code]));

  const votesByCommittee = new Map<string, number>();
  const seatsByCommittee = new Map<string, number>();
  const byDistrict = new Map<string, { votes: number; seats: number }>();
  const sim: SimCandidate[] = [];
  const actualElectedIds = new Set<string>();

  for (const c of candidates ?? []) {
    const code = committeeCode.get(c.committee_id);
    const district = districtNumber.get(c.district_id);
    if (code === undefined || district === undefined) continue;

    votesByCommittee.set(code, (votesByCommittee.get(code) ?? 0) + c.votes);
    if (c.won_mandate) {
      seatsByCommittee.set(code, (seatsByCommittee.get(code) ?? 0) + 1);
      actualElectedIds.add(c.id);
    }

    const key = `${code}|${district}`;
    const cell = byDistrict.get(key) ?? { votes: 0, seats: 0 };
    cell.votes += c.votes;
    if (c.won_mandate) cell.seats++;
    byDistrict.set(key, cell);

    sim.push({
      id: c.id,
      fullName: c.full_name,
      committeeCode: code,
      districtNumber: district,
      listPosition: c.list_position,
      votes: c.votes,
      councilorId: c.councilor_id,
    });
  }

  const committeeRows: ElectionCommittee[] = (committees ?? [])
    .map((c) => ({
      code: c.code,
      name: c.name,
      shortName: c.short_name,
      listNumber: c.list_number,
      votes: votesByCommittee.get(c.code) ?? 0,
      seats: seatsByCommittee.get(c.code) ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes);

  return {
    heldOn: election.held_on,
    seats: election.seats,
    totalVotes: [...votesByCommittee.values()].reduce((a, b) => a + b, 0),
    districts: (districts ?? []).map((d) => ({
      number: d.number,
      seats: d.seats,
      validVotes: d.valid_votes,
    })),
    committees: committeeRows,
    candidates: sim,
    byDistrict,
    actualElectedIds,
  };
}
