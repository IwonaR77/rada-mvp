// Bez tego przeglądarka nie dostawała żadnego HTML-a, dopóki cały łańcuch
// zapytań do Supabase na tej stronie się nie skończył — zerowy streaming bił
// bezpośrednio w FCP/LCP. Ten plik włącza Suspense-owy strumień Next.jsa:
// ten szkielet renderuje się natychmiast, treść dopływa, gdy jest gotowa.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 animate-pulse flex-col gap-10 px-6 py-16">
      <div>
        <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-40 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-24 rounded-full bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
