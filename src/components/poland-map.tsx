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

export function PolandMap({ councils }: { councils: CouncilPin[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
                  onClick={() => router.push(`/rada/${c.id}`)}
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
        {councils.map((c) => {
          const { x, y } = latLngToPercent(c.lat, c.lng);
          const isHovered = hoveredId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => router.push(`/rada/${c.id}`)}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className="group absolute -translate-x-1/2 -translate-y-full cursor-pointer"
            >
              <div
                className={`h-3.5 w-3.5 rounded-full border-2 border-white shadow transition-transform dark:border-zinc-950 ${
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
      </p>
    </div>
  );
}
