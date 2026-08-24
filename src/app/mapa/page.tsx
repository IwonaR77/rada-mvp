import { redirect } from "next/navigation";
import { DEFAULT_COUNCIL_ID } from "@/lib/launch-config";

// Mapa jest celowo ukryta (patrz launch-config.ts) — przekierowanie działa
// niezawodnie także przy bezpośrednim wejściu na ten adres, nie tylko przy
// nawigacji z linku (żadne linki tu już zresztą nie prowadzą). Poprzednia
// implementacja (PolandMap, kształty granic) zostaje w historii gita — to
// zawężenie zakresu na czas startu, nie usunięcie funkcji.
export default function Mapa() {
  redirect(`/rada/${DEFAULT_COUNCIL_ID}`);
}
