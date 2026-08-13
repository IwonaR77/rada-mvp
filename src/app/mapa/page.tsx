import { createClient } from "@/lib/supabase/server";
import { PolandMap } from "@/components/poland-map";
import { BOUNDARIES } from "@/lib/granice";

// Mapa mieszkała pod "/", ale ten adres stał się rozjazdem: zalogowanego z
// ulubioną radą odsyła prosto do niej. Mapa potrzebowała więc własnego adresu,
// do którego można wrócić — bez niego "← Mapa" na stronie rady wracałoby na tę
// samą stronę rady. Niezalogowanego odcina tu bramka z proxy.ts (adres nie jest
// w PUBLIC_PATHS), więc strona nie powtarza tego sprawdzenia.
export default async function Mapa() {
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

  // Obszary rysowane kształtem, nie pinezką (rady powiatów). Link powstaje
  // tylko wtedy, gdy rada o zadeklarowanej nazwie już istnieje — kształt można
  // więc pokazać wcześniej, a zacznie prowadzić do rady sam, bez zmian w kodzie.
  const shapes = BOUNDARIES.map((b) => {
    const council = (councils ?? []).find((c) => c.name === b.councilName);
    return {
      slug: b.slug,
      label: b.label,
      ring: b.ring,
      href: council ? `/rada/${council.id}` : undefined,
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

      <PolandMap councils={pins} boundaries={shapes} />
    </div>
  );
}
