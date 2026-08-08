import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href="/regulamin" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Regulamin
        </Link>
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
        <Link
          href="/polityka-prywatnosci"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Polityka Prywatności
        </Link>
      </div>
    </footer>
  );
}
