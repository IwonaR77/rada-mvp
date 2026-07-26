import { createClient } from "@/lib/supabase/server";
import { PolandMap } from "@/components/poland-map";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

function SpeechGraphic() {
  return (
    <svg
      viewBox="0 0 320 260"
      className="h-full w-full max-w-sm text-zinc-300 dark:text-zinc-700"
      fill="none"
    >
      <rect
        x="20"
        y="30"
        width="150"
        height="90"
        rx="18"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M55 120 L55 150 L90 120"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <rect
        x="150"
        y="140"
        width="150"
        height="90"
        rx="18"
        stroke="currentColor"
        strokeWidth="4"
        className="text-zinc-400 dark:text-zinc-600"
      />
      <path
        d="M265 230 L265 200 L230 230"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        className="text-zinc-400 dark:text-zinc-600"
      />
      <line
        x1="45"
        y1="55"
        x2="140"
        y2="55"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="45"
        y1="75"
        x2="110"
        y2="75"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-12 bg-zinc-50 px-6 py-16 dark:bg-black lg:flex-row lg:gap-16">
        <div className="flex w-full max-w-sm items-center justify-center">
          <SpeechGraphic />
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

  const { data: councils } = await supabase
    .from("council")
    .select("id, name, city:city_id(name, lat, lng)");

  const pins = (councils ?? [])
    .filter((c) => c.city?.lat != null && c.city?.lng != null)
    .map((c) => ({
      id: c.id,
      councilName: c.name,
      cityName: c.city!.name,
      lat: c.city!.lat as number,
      lng: c.city!.lng as number,
    }));

  return (
    <div className="flex flex-1 flex-col items-center gap-3 bg-zinc-50 px-6 py-16 dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Rada
      </h1>
      <p className="mb-8 max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Sprawdź, kto naprawdę zabiera głos na sesjach Twojej rady.
      </p>
      <PolandMap councils={pins} />
    </div>
  );
}
