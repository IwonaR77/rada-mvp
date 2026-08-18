"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const POZYCJE = [
  {
    href: "/admin/konta",
    etykieta: "Zarządzanie dostępem",
    opis: "Konta, uprawnienia i wnioski",
    zLicznikiem: true,
  },
  {
    href: "/admin/limity",
    etykieta: "Statystyki i limity",
    opis: "Baza, transkrypcja, rozpisywanie sesji",
    zLicznikiem: false,
  },
];

/**
 * Menu administracyjne w górnym pasku — widoczne wyłącznie dla managerów.
 *
 * Osobny komponent kliencki, bo pasek jest serwerowy: rozwijanie wymaga stanu,
 * zamykania kliknięciem obok i klawiszem Escape. Liczba oczekujących wniosków
 * siedzi na przycisku, nie w środku menu — inaczej trzeba by je rozwinąć, żeby
 * dowiedzieć się, że jest co robić.
 */
export function AdminMenu({ pendingRequestCount }: { pendingRequestCount: number }) {
  const [otwarte, setOtwarte] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Zamknięcie po przejściu na inną stronę — bez tego menu zostaje otwarte
  // nad nowym widokiem.
  useEffect(() => setOtwarte(false), [pathname]);

  useEffect(() => {
    if (!otwarte) return;
    const pozaMenu = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOtwarte(false);
    };
    const naEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOtwarte(false);
    };
    document.addEventListener("mousedown", pozaMenu);
    document.addEventListener("keydown", naEscape);
    return () => {
      document.removeEventListener("mousedown", pozaMenu);
      document.removeEventListener("keydown", naEscape);
    };
  }, [otwarte]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOtwarte((v) => !v)}
        aria-expanded={otwarte}
        aria-haspopup="menu"
        className="flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Administracja
        {pendingRequestCount > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            {pendingRequestCount}
          </span>
        )}
        <span aria-hidden className={`text-[10px] transition-transform ${otwarte ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {otwarte && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          {POZYCJE.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              role="menuitem"
              className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <span className="flex items-center justify-between text-sm text-zinc-900 dark:text-zinc-100">
                {p.etykieta}
                {p.zLicznikiem && pendingRequestCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    {pendingRequestCount}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">{p.opis}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
