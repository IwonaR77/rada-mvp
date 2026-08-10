/**
 * Pasek postępu tagowania mówców, liczony **czasem wypowiedzi**, nie ich liczbą.
 *
 * Segmenty są krótkie i bardzo nierówne, więc „ile jeszcze zostało" mierzy się
 * godzinami nagrania do przesłuchania, a nie liczbą wierszy w tabeli.
 *
 * Potwierdzone i zaproponowane są rozdzielone celowo. To nie jest niuans:
 * w Radzie Miejskiej zaproponowanych jest dziś kilka razy więcej niż
 * potwierdzonych (propozycje z dopasowania do protokołów), więc wspólny pasek
 * pokazywałby postęp wielokrotnie większy niż faktycznie zatwierdzony przez
 * człowieka.
 */
export function TaggingProgress({
  totalSeconds,
  finalizedSeconds,
  proposedSeconds,
  label = "Przypisani mówcy",
}: {
  totalSeconds: number;
  finalizedSeconds: number;
  proposedSeconds: number;
  label?: string;
}) {
  if (totalSeconds <= 0) return null;

  const pct = (v: number) => (100 * v) / totalSeconds;
  const finalizedPct = pct(finalizedSeconds);
  const proposedPct = pct(proposedSeconds);
  const remaining = Math.max(0, totalSeconds - finalizedSeconds - proposedSeconds);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span>
          {finalizedPct.toFixed(1)}% potwierdzone
          {proposedSeconds > 0 && (
            <span className="text-zinc-400">
              {" "}
              · {proposedPct.toFixed(1)}% zaproponowane
            </span>
          )}
        </span>
      </div>
      <div className="flex h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="bg-emerald-500/70"
          style={{ width: `${finalizedPct}%` }}
        />
        {/* Zaproponowane w słabszym odcieniu tego samego koloru, nie w innym —
            to ten sam rodzaj postępu, tylko niepotwierdzony. */}
        <div
          className="bg-emerald-500/25"
          style={{ width: `${proposedPct}%` }}
        />
      </div>
      <p className="text-xs text-zinc-400">
        Zostało {formatHours(remaining)} z {formatHours(totalSeconds)} nagrania.
      </p>
    </div>
  );
}

function formatHours(seconds: number) {
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min`;
  return `${hours.toFixed(1).replace(".", ",")} h`;
}
