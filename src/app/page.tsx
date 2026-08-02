import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { PolandMap } from "@/components/poland-map";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

export default async function Home() {
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

          <p className="text-xs italic leading-relaxed text-zinc-400">
            Certified Human-Cruelty-Free
            <br />
            No humans were exploited, harmed, or overworked in the making of
            this site.
          </p>
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
