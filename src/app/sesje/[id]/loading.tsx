// Patrz uzasadnienie w src/app/rada/[councilId]/loading.tsx — ta strona ma
// najdłuższy łańcuch sekwencyjnych zapytań w aplikacji.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-1 animate-pulse flex-col gap-6 px-6 py-12">
      <div className="h-6 w-48 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-8 w-96 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="aspect-video w-full rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}
