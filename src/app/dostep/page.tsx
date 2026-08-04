import { createClient } from "@/lib/supabase/server";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { AccessRequestForm } from "@/components/access-request-form";
import { ACCESS_LEVELS, describeGrant } from "@/lib/access-levels";

function LevelsList() {
  return (
    <ul className="flex flex-col gap-3">
      {Object.values(ACCESS_LEVELS).map((def) => (
        <li
          key={def.label}
          className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            {def.label}
          </p>
          <p className="text-zinc-500">{def.description}</p>
        </li>
      ))}
    </ul>
  );
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function DostepPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Dostęp do współtworzenia
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Przeglądanie sesji, spraw i profili radnych jest publicznie
            dostępne bez logowania. Współtworzenie — przypisywanie wypowiedzi
            mówcom, zatwierdzanie spraw, pobieranie transkryptów — wymaga
            konta i zatwierdzonej prośby o dostęp.
          </p>
        </div>
        <LevelsList />
        <GoogleSignInButton />
      </div>
    );
  }

  const [{ data: councils }, { data: roles }, { data: requests }] =
    await Promise.all([
      supabase.from("council").select("id, name").order("name"),
      supabase
        .from("user_role")
        .select("permissions, scope_council_id")
        .eq("app_user_id", user.id),
      supabase
        .from("access_request")
        .select(
          "id, requested_level, scope_council_id, status, created_at, decision_note"
        )
        .eq("app_user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

  const grantedPermissions = (roles ?? []).flatMap((r) => r.permissions ?? []);
  const grantLabel = describeGrant(grantedPermissions);
  const pending = (requests ?? []).find((r) => r.status === "pending");
  const latestDenied =
    !pending && (requests ?? [])[0]?.status === "denied"
      ? requests![0]
      : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Dostęp do współtworzenia
      </h1>

      {grantLabel && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          Masz już dostęp na poziomie: <strong>{grantLabel}</strong>.
        </p>
      )}

      {!grantLabel && pending && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
          Twoja prośba (
          {ACCESS_LEVELS[pending.requested_level as keyof typeof ACCESS_LEVELS]
            ?.label ?? pending.requested_level}
          ) z {formatDate(pending.created_at)} czeka na rozpatrzenie.
        </p>
      )}

      {!grantLabel && !pending && (
        <>
          {latestDenied && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Twoja poprzednia prośba została odrzucona
              {latestDenied.decision_note
                ? `: ${latestDenied.decision_note}`
                : "."}{" "}
              Możesz spróbować ponownie poniżej.
            </p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Poziomy dostępu do współtworzenia:
          </p>
          <LevelsList />
          <AccessRequestForm councils={councils ?? []} />
        </>
      )}
    </div>
  );
}
