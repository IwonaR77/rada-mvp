"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { latLngToPercent } from "@/lib/poland-map";

type CouncilPin = {
  id: string;
  councilName: string;
  cityName: string;
  lat: number;
  lng: number;
};

export type BoundaryShape = {
  slug: string;
  label: string;
  ring: [number, number][];
  /** Brak = obszar tylko widoczny, jeszcze bez rady do której prowadzi. */
  href?: string;
};

function councilHref(c: CouncilPin) {
  return `/rada/${c.id}`;
}

export function PolandMap({
  councils,
  boundaries = [],
}: {
  councils: CouncilPin[];
  boundaries?: BoundaryShape[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);

  // viewBox "0 0 100 100" + preserveAspectRatio="none" sprawia, że jednostki
  // SVG to wprost procenty — te same, które latLngToPercent() liczy dla
  // pinezek. Dzięki temu kształt jest wyrównany z pinezkami bez osobnej
  // matematyki projekcji.
  const shapes = useMemo(
    () =>
      boundaries.map((b) => {
        const pts = b.ring.map(([lat, lng]) => latLngToPercent(lat, lng));
        const d =
          pts
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
            .join(" ") + " Z";
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return {
          ...b,
          d,
          // Środek prostokąta otaczającego, nie centroid — stabilniejszy dla
          // wklęsłych kształtów i wystarczający do umieszczenia etykiety.
          cx: (Math.min(...xs) + Math.max(...xs)) / 2,
          cy: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
      }),
    [boundaries]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return councils.filter(
      (c) =>
        c.cityName.toLowerCase().includes(q) ||
        c.councilName.toLowerCase().includes(q)
    );
  }, [query, councils]);

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-8">
      <div className="relative w-full max-w-sm">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj miasta lub rady..."
          className="w-full rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        {matches.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => router.push(councilHref(c))}
                  className="block w-full px-5 py-2.5 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  {c.councilName} <span className="text-zinc-400">— {c.cityName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative w-full">
        <img
          src="/poland.svg"
          alt="Mapa Polski"
          className="w-full select-none"
          draggable={false}
        />
        {/* Nakładka z obszarami leży POD pinezkami (wcześniej w DOM), bo
            miasto powiatowe wypada wewnątrz swojego powiatu — pinezka gminy
            musi pozostać osiągalna. Samo <svg> nie łapie zdarzeń; robią to
            tylko ścieżki, więc nakładka nie blokuje reszty mapy. */}
        {shapes.length > 0 && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden={shapes.every((s) => !s.href)}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {shapes.map((s) => {
              const active = hoveredArea === s.slug;
              return (
                <path
                  key={s.slug}
                  d={s.d}
                  vectorEffect="non-scaling-stroke"
                  role={s.href ? "link" : undefined}
                  tabIndex={s.href ? 0 : undefined}
                  aria-label={s.href ? s.label : undefined}
                  onMouseEnter={() => setHoveredArea(s.slug)}
                  onMouseLeave={() => setHoveredArea(null)}
                  onFocus={() => setHoveredArea(s.slug)}
                  onBlur={() => setHoveredArea(null)}
                  onClick={s.href ? () => router.push(s.href!) : undefined}
                  onKeyDown={
                    s.href
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(s.href!);
                          }
                        }
                      : undefined
                  }
                  className={`pointer-events-auto outline-none transition-colors ${
                    s.href ? "cursor-pointer" : ""
                  } ${
                    active
                      ? "fill-red-500/35 stroke-red-600"
                      : "fill-red-500/15 stroke-red-500/70"
                  }`}
                  strokeWidth={active ? 1.5 : 1}
                />
              );
            })}
          </svg>
        )}

        {shapes.map((s) =>
          hoveredArea === s.slug ? (
            <span
              key={`${s.slug}-label`}
              style={{ left: `${s.cx}%`, top: `${s.cy}%` }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
            >
              {s.label}
              {!s.href && (
                <span className="ml-1 font-normal opacity-60">(wkrótce)</span>
              )}
            </span>
          ) : null
        )}

        {councils.map((c) => {
          const { x, y } = latLngToPercent(c.lat, c.lng);
          const isHovered = hoveredId === c.id;
          // Kropka jest wyśrodkowana NA współrzędnych (-translate-y-1/2), nie
          // zakotwiczona dolną krawędzią. Przy -translate-y-full jej środek
          // wypadał 14 px wyżej niż faktyczne położenie miasta — niewidoczne,
          // dopóki na mapie nie było obszarów, ale Grójec leży tylko ~8 px od
          // północnej granicy swojego powiatu, więc kropka wychodziła poza nią.
          return (
            <button
              key={c.id}
              onClick={() => router.push(councilHref(c))}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
            >
              <div
                className={`h-2.5 w-2.5 rounded-full border-2 border-white shadow transition-transform dark:border-zinc-950 ${
                  isHovered ? "scale-125 bg-red-500" : "bg-red-600"
                }`}
              />
              {isHovered && (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow dark:bg-zinc-100 dark:text-zinc-900">
                  {c.cityName}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-zinc-400">
        Mapa: NordNordWest / Wikimedia Commons (CC BY-SA 3.0)
        {shapes.length > 0 && <> · Granice: © OpenStreetMap (ODbL)</>}
      </p>
    </div>
  );
}
