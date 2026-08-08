"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function RadniList({
  councilId,
  councilors,
}: {
  councilId: string;
  councilors: { id: string; full_name: string }[];
}) {
  const pathname = usePathname();

  if (councilors.length === 0) {
    return <p className="text-sm text-zinc-500">Brak radnych w tej kadencji.</p>;
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {councilors.map((c) => {
        const href = `/rada/${councilId}/radni/${c.id}`;
        const isActive = pathname === href;
        return (
          <Link
            key={c.id}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {c.full_name}
          </Link>
        );
      })}
    </nav>
  );
}
