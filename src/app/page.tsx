import { createClient } from "@/lib/supabase/server";
import { PolandMap } from "@/components/poland-map";

export default async function Home() {
  const supabase = await createClient();
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
