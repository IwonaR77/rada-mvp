export default function AuthErrorPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32">
      <h1 className="text-2xl font-semibold">Błąd logowania</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Nie udało się zalogować. Spróbuj ponownie.
      </p>
    </div>
  );
}
