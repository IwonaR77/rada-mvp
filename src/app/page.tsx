import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { PolandMap } from "@/components/poland-map";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

function formatKadencjaDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pl-PL", {
    year: "numeric",
  });
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ kadencja?: string }>;
}) {
  const { kadencja } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-12 bg-zinc-50 px-6 py-16 dark:bg-black lg:flex-row lg:gap-16">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl shadow-lg">
          <Image
            src="/homepage-hero.png"
            alt="Pusta sala obrad rady"
            width={1024}
            height={1400}
            priority
            className="h-auto w-full object-cover"
          />
        </div>

        <div className="flex w-full max-w-md flex-col gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Rada
            </h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Sprawdź, kto naprawdę zabiera głos na sesjach Twojej rady.
              Rada gromadzi nagrania i transkrypcje obrad rad miejskich i
              gminnych, dzieląc je na wypowiedzi przypisane do
              konkretnych radnych i urzędników — dzięki temu widać nie tylko
              co zostało powiedziane, ale też kto naprawdę bierze udział w
              obradach, a kto pozostaje w cieniu.
            </p>
          </div>

          <p className="text-sm text-zinc-500">
            Serwis dostępny wyłącznie dla zarejestrowanych użytkowników.
            Rejestracja jest darmowa i taka pozostanie.
          </p>

          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <GoogleSignInButton />
            <p className="text-xs text-zinc-400">
              Wkrótce: więcej sposobów logowania.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Only kadencje that actually have a recording somewhere qualify as a
  // filter option — a term with zero sourced sessions isn't browsable yet.
  const { data: termMeetingRows } = await supabase
    .from("term")
    .select("id, start_date, end_date, label, council_id, meeting:meeting!inner(id)")
    .not("meeting.video_url", "is", null);

  const qualifyingTerms = new Map<
    string,
    { id: string; start_date: string; end_date: string | null; label: string | null; council_id: string }
  >();
  for (const row of termMeetingRows ?? []) {
    qualifyingTerms.set(row.id, {
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      label: row.label,
      council_id: row.council_id,
    });
  }
  const kadencjaOptions = new Map<string, { start_date: string; label: string | null }>();
  for (const t of qualifyingTerms.values()) {
    if (!kadencjaOptions.has(t.start_date)) {
      kadencjaOptions.set(t.start_date, { start_date: t.start_date, label: t.label });
    }
  }
  const sortedKadencjaOptions = [...kadencjaOptions.values()].sort((a, b) =>
    b.start_date.localeCompare(a.start_date)
  );

  let savedKadencja: string | null = null;
  if (user) {
    const { data: appUser } = await supabase
      .from("app_user")
      .select("preferred_term_start_date")
      .eq("id", user.id)
      .maybeSingle();
    savedKadencja = appUser?.preferred_term_start_date ?? null;
  }

  const selectedKadencja =
    (kadencja && kadencjaOptions.has(kadencja) ? kadencja : null) ??
    (savedKadencja && kadencjaOptions.has(savedKadencja) ? savedKadencja : null) ??
    sortedKadencjaOptions[0]?.start_date ??
    null;

  if (user && selectedKadencja && selectedKadencja !== savedKadencja) {
    await supabase
      .from("app_user")
      .update({ preferred_term_start_date: selectedKadencja })
      .eq("id", user.id);
  }

  const { data: councils } = await supabase
    .from("council")
    .select("id, name, city:city_id(name, lat, lng)");

  const pins = (councils ?? [])
    .filter((c) => c.city?.lat != null && c.city?.lng != null)
    .map((c) => {
      const matchingTerm = selectedKadencja
        ? [...qualifyingTerms.values()].find(
            (t) => t.council_id === c.id && t.start_date === selectedKadencja
          )
        : undefined;
      return {
        id: c.id,
        councilName: c.name,
        cityName: c.city!.name,
        lat: c.city!.lat as number,
        lng: c.city!.lng as number,
        termId: matchingTerm?.id ?? null,
      };
    });

  return (
    <div className="flex flex-1 flex-col items-center gap-3 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Rada
      </h1>
      <p className="mb-8 max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Sprawdź, kto naprawdę zabiera głos na sesjach Twojej rady.
      </p>

      {sortedKadencjaOptions.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {sortedKadencjaOptions.map((t) => (
            <Link
              key={t.start_date}
              href={`/?kadencja=${t.start_date}`}
              prefetch={false}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                t.start_date === selectedKadencja
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {t.label ?? formatKadencjaDate(t.start_date)}
            </Link>
          ))}
        </div>
      )}

      <PolandMap councils={pins} />
    </div>
  );
}
