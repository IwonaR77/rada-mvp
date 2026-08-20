import type { ElectionData } from "@/lib/election-data";
import { buildDistributionNote } from "@/lib/vote-distribution-note";
import { committeeColorVar } from "@/lib/election-committee";

const fmt = (n: number) => n.toLocaleString("pl-PL");
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const pp = (x: number) =>
  x === 0 ? "0" : `${x > 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1).replace(".", ",")}`;

function Chip({ code, slot }: { code: string; slot: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: committeeColorVar(slot) }}
      />
      <span className="font-mono text-[10px] leading-none text-zinc-500 dark:text-zinc-400">
        {code}
      </span>
    </span>
  );
}

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const TD = "px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300";
const NUM = `${TD} text-right tabular-nums`;

export function ElectionResultsTables({
  election,
  slotOf,
}: {
  election: ElectionData;
  slotOf: Map<string, number>;
}) {
  const { committees, totalVotes, seats, districts, byDistrict } = election;
  const note = buildDistributionNote(election);

  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={TH}>Komitet</th>
              <th className={`${TH} text-right`}>Głosy</th>
              <th className={`${TH} text-right`}>% głosów</th>
              <th className={`${TH} text-right`}>Mandaty</th>
              <th className={`${TH} text-right`}>% mandatów</th>
              <th className={`${TH} text-right`}>Różnica</th>
            </tr>
          </thead>
          <tbody>
            {committees.map((c) => {
              const vs = c.votes / totalVotes;
              const ss = c.seats / seats;
              return (
                <tr key={c.code} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className={`${TD} border-t border-zinc-200 dark:border-zinc-800`}>
                    <span className="flex items-center gap-2">
                      <Chip code={c.code} slot={slotOf.get(c.code) ?? 0} />
                      <span>{c.shortName}</span>
                    </span>
                  </td>
                  <td className={`${NUM} border-t border-zinc-200 dark:border-zinc-800`}>{fmt(c.votes)}</td>
                  <td className={`${NUM} border-t border-zinc-200 dark:border-zinc-800`}>{pct(vs)}</td>
                  <td className={`${NUM} border-t border-zinc-200 dark:border-zinc-800 font-semibold`}>
                    {c.seats}
                  </td>
                  <td className={`${NUM} border-t border-zinc-200 dark:border-zinc-800`}>{pct(ss)}</td>
                  <td
                    className={`${NUM} border-t border-zinc-200 dark:border-zinc-800 ${
                      ss - vs > 0.005
                        ? "text-emerald-700 dark:text-emerald-400"
                        : ss - vs < -0.005
                          ? "text-rose-700 dark:text-rose-400"
                          : ""
                    }`}
                  >
                    {pp(ss - vs)} p.p.
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-zinc-300 font-medium dark:border-zinc-700">
              <td className={`${TD} border-t-2 border-zinc-300 dark:border-zinc-700`}>Razem</td>
              <td className={`${NUM} border-t-2 border-zinc-300 dark:border-zinc-700`}>{fmt(totalVotes)}</td>
              <td className={`${NUM} border-t-2 border-zinc-300 dark:border-zinc-700`}>100,0%</td>
              <td className={`${NUM} border-t-2 border-zinc-300 dark:border-zinc-700`}>{seats}</td>
              <td className={`${NUM} border-t-2 border-zinc-300 dark:border-zinc-700`}>100,0%</td>
              <td className={`${NUM} border-t-2 border-zinc-300 dark:border-zinc-700`} />
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500">
          „Różnica&rdquo; to przewaga udziału w mandatach nad udziałem w głosach — miara tego,
          na ile przelicznik odbiega od proporcjonalności.
        </p>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Rozkład po okręgach
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={TH}>Komitet</th>
                {districts.map((d) => (
                  <th key={d.number} className={`${TH} text-right`}>
                    Okręg {d.number}
                    <span className="ml-1 font-normal normal-case text-zinc-400">
                      ({d.seats} mand.)
                    </span>
                  </th>
                ))}
                <th className={`${TH} text-right`}>Razem</th>
              </tr>
            </thead>
            <tbody>
              {committees.map((c) => (
                <tr key={c.code}>
                  <td className={`${TD} border-t border-zinc-200 dark:border-zinc-800`}>
                    <span className="flex items-center gap-2">
                      <Chip code={c.code} slot={slotOf.get(c.code) ?? 0} />
                      <span className="truncate">{c.shortName}</span>
                    </span>
                  </td>
                  {districts.map((d) => {
                    const cell = byDistrict.get(`${c.code}|${d.number}`);
                    return (
                      <td
                        key={d.number}
                        className={`${NUM} border-t border-zinc-200 dark:border-zinc-800`}
                      >
                        {fmt(cell?.votes ?? 0)}
                        <span
                          className={
                            cell?.seats
                              ? "ml-2 font-semibold text-zinc-900 dark:text-zinc-100"
                              : "ml-2 text-zinc-400"
                          }
                        >
                          {cell?.seats ?? 0} mand.
                        </span>
                      </td>
                    );
                  })}
                  <td className={`${NUM} border-t border-zinc-200 dark:border-zinc-800`}>
                    {fmt(c.votes)}
                    <span className="ml-2 font-semibold text-zinc-900 dark:text-zinc-100">
                      {c.seats} mand.
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {note.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Skąd ten podział mandatów
          </h4>
          <ul className="flex flex-col gap-2">
            {note.map((f, i) => (
              <li key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {f.text}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Notatka jest wyliczana z danych PKW przy każdym wyświetleniu strony — opisuje
            wyłącznie arytmetykę przeliczenia głosów na mandaty, a nie motywy wyborców.
          </p>
        </div>
      )}
    </div>
  );
}
