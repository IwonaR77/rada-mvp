import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccessRequestRow } from "@/components/access-request-row";
import { ACCESS_LEVELS } from "@/lib/access-levels";

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function AdminDostepPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isManager } = await supabase.rpc("is_manager", {
    uid: user.id,
  });
  if (!isManager) notFound();

  const { data: requests } = await supabase
    .from("access_request")
    .select(
      "id, requested_level, message, status, created_at, decided_at, decision_note, app_user:app_user_id(display_name), council:scope_council_id(name)"
    )
    .order("created_at", { ascending: false });

  const rows = (requests ?? []).map((r) => ({
    ...r,
    requesterName: r.app_user?.display_name ?? "Nieznany użytkownik",
    councilName: r.council?.name ?? null,
  }));

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Prośby o dostęp
      </h1>

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Oczekujące ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">Brak oczekujących próśb.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <AccessRequestRow key={r.id} request={r} />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Historia
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {r.requesterName} —{" "}
                    {ACCESS_LEVELS[
                      r.requested_level as keyof typeof ACCESS_LEVELS
                    ]?.label ?? r.requested_level}
                    {r.councilName && ` — ${r.councilName}`}
                  </span>
                  <span
                    className={
                      r.status === "approved"
                        ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                        : "text-xs font-medium text-zinc-500"
                    }
                  >
                    {r.status === "approved" ? "Zatwierdzona" : "Odrzucona"}
                    {r.decided_at && ` — ${formatDate(r.decided_at)}`}
                  </span>
                </div>
                {r.decision_note && (
                  <p className="text-xs text-zinc-500">{r.decision_note}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
