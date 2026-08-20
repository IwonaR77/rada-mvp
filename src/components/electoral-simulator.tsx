"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  METHOD_LABELS,
  simulate,
  type Method,
  type SimCandidate,
} from "@/lib/electoral-systems";
import { countStv } from "@/lib/stv";
import { BallotLists } from "@/components/ballot-lists";
import { ListAdvantageTable } from "@/components/list-advantage-table";
import { DistrictConcentrationTable } from "@/components/district-concentration-table";
import { committeeColorVar } from "@/lib/election-committee";

const METHODS: Method[] = [
  "dhondt",
  "sainte-lague",
  "sainte-lague-mod",
  "hare-niemeyer",
  "droop",
];

// STV stoi obok metod listowych, bo nie jest przelicznikiem głosów na listy —
// liczy pojedyncze karty i wymaga preferencji, których polska karta nie zbiera.
// Dlatego osobny przycisk i osobne ostrzeżenie, a nie kolejna pozycja w rzędzie.
type Selection = Method | "stv";

const THRESHOLDS = [0, 0.03, 0.05];

const PILL_ON = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900";
const PILL_OFF =
  "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800";

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-sm transition-colors ${on ? PILL_ON : PILL_OFF}`}
    >
      {children}
    </button>
  );
}

export function ElectoralSimulator({
  candidates,
  districtSeats,
  committees,
  actualSeats,
  actualElectedIds,
  slotOf,
}: {
  candidates: SimCandidate[];
  districtSeats: [number, number][];
  committees: { code: string; shortName: string; votes: number }[];
  actualSeats: Record<string, number>;
  /**
   * Kto dostał mandat w rzeczywistych wyborach. Punktem odniesienia jest wynik
   * wyborczy, a nie dzisiejszy skład rady — dwoje radnych weszło później na
   * wakaty i mieszanie tych dwóch rzeczy zaciemniłoby porównanie ordynacji.
   */
  actualElectedIds: string[];
  slotOf: Record<string, number>;
}) {
  const [method, setMethod] = useState<Selection>("dhondt");
  const [perDistrict, setPerDistrict] = useState(true);
  const [threshold, setThreshold] = useState(0.05);

  const seatsPerDistrict = useMemo(() => new Map(districtSeats), [districtSeats]);
  const totalSeats = districtSeats.reduce((a, [, s]) => a + s, 0);
  const totalVotes = committees.reduce((a, c) => a + c.votes, 0);

  const result = useMemo(() => {
    if (method !== "stv") {
      return simulate(candidates, seatsPerDistrict, { method, perDistrict, threshold });
    }
    // STV liczy się w obrębie okręgu (albo jednego wielkiego okręgu), ale bez
    // progu — w STV rolę progu pełni kwota Droopa i doklejanie do tego progu
    // ustawowego byłoby liczeniem tej samej bariery dwa razy.
    const groups = perDistrict
      ? [...seatsPerDistrict].map(([number, seats]) => ({
          seats,
          pool: candidates.filter((c) => c.districtNumber === number),
        }))
      : [
          {
            seats: [...seatsPerDistrict.values()].reduce((a, b) => a + b, 0),
            pool: candidates,
          },
        ];
    const elected: SimCandidate[] = [];
    const log: string[] = [];
    for (const g of groups) {
      const r = countStv(g.pool, g.seats);
      elected.push(...r.elected);
      if (perDistrict) log.push(`— okręg ${g.pool[0]?.districtNumber ?? "?"} —`);
      log.push(...r.log);
    }
    const seatsByCommittee = new Map<string, number>();
    for (const c of candidates) seatsByCommittee.set(c.committeeCode, 0);
    for (const c of elected) {
      seatsByCommittee.set(c.committeeCode, (seatsByCommittee.get(c.committeeCode) ?? 0) + 1);
    }
    elected.sort((a, b) => b.votes - a.votes || a.fullName.localeCompare(b.fullName, "pl"));
    return { seatsByCommittee, elected, belowThreshold: [] as string[], stvLog: log };
  }, [candidates, seatsPerDistrict, method, perDistrict, threshold]);

  const isActual = method === "dhondt" && perDistrict && threshold === 0.05;
  const stvLog = "stvLog" in result ? result.stvLog : null;

  const actualElected = useMemo(() => new Set(actualElectedIds), [actualElectedIds]);
  const nowElected = new Set(result.elected.map((c) => c.id));
  const entering = result.elected.filter((c) => !actualElected.has(c.id));
  const leaving = candidates.filter((c) => actualElected.has(c.id) && !nowElected.has(c.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">Metoda</span>
          {METHODS.map((m) => (
            <Pill key={m} on={method === m} onClick={() => setMethod(m)}>
              {METHOD_LABELS[m]}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">
            Inna rodzina
          </span>
          <Pill on={method === "stv"} onClick={() => setMethod("stv")}>
            Głos przechodni (STV)
          </Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">Okręgi</span>
          <Pill on={perDistrict} onClick={() => setPerDistrict(true)}>
            {districtSeats.length} okręgi ({districtSeats.map(([, s]) => s).join("+")})
          </Pill>
          <Pill on={!perDistrict} onClick={() => setPerDistrict(false)}>
            jeden okręg ({totalSeats} mandatów)
          </Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">Próg</span>
          {THRESHOLDS.map((t) => (
            <Pill key={t} on={threshold === t && method !== "stv"} onClick={() => setThreshold(t)}>
              {t === 0 ? "bez progu" : `${t * 100}%`}
            </Pill>
          ))}
          {method === "stv" && (
            <span className="text-xs text-zinc-400">
              nie dotyczy STV — jego progiem jest kwota Droopa
            </span>
          )}
        </div>
      </div>

      <div
        className={`rounded-2xl border p-3 text-sm ${
          isActual
            ? "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            : "border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700"
        }`}
      >
        {method === "stv" ? (
          <>
            <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
              Uwaga: to symulacja na wymyślonym założeniu.
            </strong>{" "}
            Głos przechodni wymaga, żeby wyborca uszeregował kandydatów, a polska karta ma
            jeden krzyżyk — dalszych preferencji nie ma w żadnych danych i nie da się ich
            odtworzyć. Przyjęliśmy tu model wyborcy lojalnego wobec komitetu: kolejne
            preferencje idą do pozostałych kandydatów tego samego komitetu, malejąco liczbą
            głosów, a potem karta wygasa. Przy takim założeniu STV z natury zbliża się do
            podziału kwotą Droopa, więc wynik mówi więcej o założeniu niż o wyborcach.
          </>
        ) : isActual ? (
          <>
            To jest ordynacja obowiązująca w Polsce i wynik zgadza się co do mandatu z tym,
            co ogłosiła PKW — kolumna „różnica&rdquo; jest wszędzie zerowa. Zmień coś powyżej,
            żeby zobaczyć, jak inny przelicznik dzieli te same głosy.
          </>
        ) : (
          <>
            Wariant hipotetyczny: te same oddane głosy, inny przelicznik. To nie jest prognoza —
            przy innej ordynacji inaczej zawiązałyby się komitety i inaczej głosowaliby wyborcy.
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                Komitet
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Głosy
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Rzeczywiste
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Symulacja
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                Różnica
              </th>
            </tr>
          </thead>
          <tbody>
            {committees.map((c) => {
              const now = result.seatsByCommittee.get(c.code) ?? 0;
              const was = actualSeats[c.code] ?? 0;
              const diff = now - was;
              const cut = result.belowThreshold.includes(c.code);
              return (
                <tr key={c.code}>
                  <td className="border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: committeeColorVar(slotOf[c.code] ?? null) }}
                      />
                      <span className="font-mono text-[10px] text-zinc-500">{c.code}</span>
                      <span className="text-zinc-700 dark:text-zinc-300">{c.shortName}</span>
                      {cut && (
                        <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                          poniżej progu
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums text-zinc-500 dark:border-zinc-800">
                    {c.votes.toLocaleString("pl-PL")}
                    <span className="ml-2 text-zinc-400">
                      {((100 * c.votes) / totalVotes).toFixed(1).replace(".", ",")}%
                    </span>
                  </td>
                  <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums text-zinc-500 dark:border-zinc-800">
                    {was}
                  </td>
                  <td className="border-t border-zinc-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">
                    {now}
                  </td>
                  <td
                    className={`border-t border-zinc-200 px-3 py-2 text-right text-sm tabular-nums dark:border-zinc-800 ${
                      diff > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : diff < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-zinc-400"
                    }`}
                  >
                    {diff === 0 ? "0" : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(entering.length > 0 || leaving.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Weszliby do rady ({entering.length})
            </h4>
            <CandidateList candidates={entering} slotOf={slotOf} />
          </div>
          <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">
              Straciliby mandat ({leaving.length})
            </h4>
            <CandidateList candidates={leaving} slotOf={slotOf} />
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Pełny skład w tym wariancie ({result.elected.length})
        </h4>
        <CandidateList candidates={result.elected} slotOf={slotOf} showVotes />
      </div>

      <section>
        <h3 className="mb-1 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Miejsce na liście — czy „jedynki&rdquo; wchodzą?
        </h3>
        <p className="mb-4 text-xs text-zinc-500">
          {isActual
            ? "Wynik rzeczywisty. Pogrubieni kandydaci zdobyli mandat."
            : "Listy przeliczone wybraną wyżej metodą — pogrubienie pokazuje, kto miałby mandat w tym wariancie."}
        </p>
        <BallotLists
          candidates={candidates}
          electedIds={result.elected.map((c) => c.id)}
          committees={committees}
          slotOf={slotOf}
        />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Przegrali listą, nie liczbą głosów
        </h3>
        <ListAdvantageTable
          candidates={candidates}
          electedIds={result.elected.map((c) => c.id)}
          committees={committees}
          slotOf={slotOf}
          seatsPerDistrict={seatsPerDistrict}
          config={method === "stv" ? null : { method, perDistrict, threshold }}
        />
      </section>

      {perDistrict && method !== "stv" && (
        <section>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Ile kosztuje rozproszenie między okręgami
          </h3>
          <DistrictConcentrationTable
            candidates={candidates}
            seatsPerDistrict={seatsPerDistrict}
            electedIds={result.elected.map((c) => c.id)}
            committees={committees}
            slotOf={slotOf}
            method={method}
            threshold={threshold}
          />
        </section>
      )}

      {stvLog && stvLog.length > 0 && (
        <details className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-500">
            Przebieg liczenia STV ({stvLog.length} kroków)
          </summary>
          <ol className="mt-2 flex flex-col gap-1">
            {stvLog.map((line, i) => (
              <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400">
                {line}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  slotOf,
  showVotes = false,
}: {
  candidates: SimCandidate[];
  slotOf: Record<string, number>;
  showVotes?: boolean;
}) {
  if (!candidates.length) {
    return <p className="text-sm text-zinc-400">Nikt — skład bez zmian.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {candidates.map((c) => (
        <li key={c.id} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: committeeColorVar(slotOf[c.committeeCode] ?? null) }}
          />
          <span className="w-10 shrink-0 font-mono text-[10px] text-zinc-500">
            {c.committeeCode}
          </span>
          {c.councilorId ? (
            <Link
              href={`/radny/${c.councilorId}`}
              prefetch={false}
              className="text-zinc-700 hover:underline dark:text-zinc-300"
            >
              {c.fullName}
            </Link>
          ) : (
            <span className="text-zinc-700 dark:text-zinc-300">{c.fullName}</span>
          )}
          {showVotes && (
            <span className="ml-auto shrink-0 tabular-nums text-xs text-zinc-500">
              {c.votes.toLocaleString("pl-PL")} gł.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
