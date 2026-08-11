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
          {formatPct(finalizedPct)}% potwierdzone
          {proposedSeconds > 0 && (
            <span className="text-zinc-400">
              {" "}
              · {formatPct(proposedPct)}% zaproponowane
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

/**
 * Dokładność jest tu funkcją użytkową, nie kosmetyką.
 *
 * Przy 97 godzinach nagrania jedno miejsce po przecinku znaczy działkę co
 * 0,1 h, czyli 6 minut — kilka otagowanych segmentów nie rusza takiej liczby
 * ani o krok i praca wygląda na bezowocną. Godziny z minutami dają działkę
 * co minutę, więc licznik reaguje na każde kilka segmentów.
 */
function formatHours(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Dwa miejsca po przecinku z tego samego powodu: przy 97 godzinach 0,01%
 * to ok. 35 sekund nagrania, czyli mniej więcej jeden segment. Procent
 * przestaje wtedy stać w miejscu przez pół godziny pracy.
 */
function formatPct(value: number) {
  return value.toFixed(2).replace(".", ",");
}
