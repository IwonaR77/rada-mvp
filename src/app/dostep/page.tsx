import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { AccessRequestForm } from "@/components/access-request-form";
import {
  ACCESS_LEVELS,
  BROWSE_LABEL,
  alreadyHeldLevels,
  describeGrant,
  tierChipClass,
  type AccessLevel,
} from "@/lib/access-levels";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </h2>
  );
}

// Same container treatment as the manager table on /admin/konta: one rounded
// panel with hairline dividers, rather than a stack of separately bordered
// cards.
function LevelsList({ levels }: { levels: AccessLevel[] }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {levels.map((key) => {
        const def = ACCESS_LEVELS[key];
        return (
          <li key={key} className="flex flex-col gap-1.5 p-4">
            <span className={tierChipClass(def.label)}>{def.label}</span>
            <p className="text-sm text-zinc-500">{def.description}</p>
          </li>
        );
      })}
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
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Dostęp do współtworzenia
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Przeglądanie Serwisu wymaga zalogowania — konto od razu otrzymuje
            podstawowy dostęp do przeglądania. Współtworzenie — przypisywanie
            wypowiedzi mówcom, zatwierdzanie spraw, pobieranie transkryptów —
            wymaga dodatkowo zatwierdzonej prośby o dostęp.
          </p>
        </div>
        <section>
          <SectionHeading>Poziomy dostępu</SectionHeading>
          <LevelsList levels={Object.keys(ACCESS_LEVELS) as AccessLevel[]} />
        </section>
        <GoogleSignInButton />
      </div>
    );
  }

  const [{ data: councils }, { data: roles }, { data: requests }, { data: isManager }] =
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
      supabase.rpc("is_manager", { uid: user.id }),
    ]);

  const grantedPermissions = (roles ?? []).flatMap((r) => r.permissions ?? []);
  const held = alreadyHeldLevels(grantedPermissions);
  const availableLevels = (Object.keys(ACCESS_LEVELS) as AccessLevel[]).filter(
    (level) => !held.includes(level)
  );
  const atMaxSelfServiceLevel = availableLevels.length === 0;
  const pending = (requests ?? []).find((r) => r.status === "pending");
  const latestDenied =
    !pending && (requests ?? [])[0]?.status === "denied"
      ? requests![0]
      : null;

  // Shown per grant rather than as one pooled label, so a scoped grant is
  // visible as scoped — the same level/scope pairing the manager sees in the
  // /admin/konta table. Council names come from the list already fetched
  // above for the request form, so this costs no extra query.
  const councilNameById = new Map((councils ?? []).map((c) => [c.id, c.name]));
  const myGrants = (roles ?? []).map((r, i) => ({
    key: `${r.scope_council_id ?? "global"}-${i}`,
    label: describeGrant(r.permissions ?? []) ?? BROWSE_LABEL,
    scope: r.scope_council_id
      ? councilNameById.get(r.scope_council_id) ?? "nieznana rada"
      : "cała platforma",
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Dostęp do współtworzenia
        </h1>
        {isManager && (
          <Link
            href="/admin/konta"
            className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            zarządzaj kontami →
          </Link>
        )}
      </div>

      {myGrants.length > 0 && (
        <section>
          <SectionHeading>Twoje uprawnienia</SectionHeading>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {myGrants.map((g) => (
              <li
                key={g.key}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className={tierChipClass(g.label)}>{g.label}</span>
                <span className="text-xs text-zinc-500">{g.scope}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending && (
        <p className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
          Twoja prośba (
          {ACCESS_LEVELS[pending.requested_level as keyof typeof ACCESS_LEVELS]
            ?.label ?? pending.requested_level}
          ) z {formatDate(pending.created_at)} czeka na rozpatrzenie.
        </p>
      )}

      {!pending && atMaxSelfServiceLevel && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Masz już najwyższy dostępny poziom samoobsługowy (Moderator). Dalsze
          uprawnienia (np. Manager) nadaje wyłącznie inny Manager.
        </p>
      )}

      {!pending && !atMaxSelfServiceLevel && (
        <>
          {latestDenied && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              Twoja poprzednia prośba została odrzucona
              {latestDenied.decision_note
                ? `: ${latestDenied.decision_note}`
                : "."}{" "}
              Możesz spróbować ponownie poniżej.
            </p>
          )}
          {/* The form's own radio cards already carry each level's label and
              description, so there is no separate LevelsList here — showing
              both repeated the same text twice. */}
          <section>
            <SectionHeading>Poproś o dostęp</SectionHeading>
            <AccessRequestForm
              councils={councils ?? []}
              availableLevels={availableLevels}
            />
          </section>
        </>
      )}
    </div>
  );
}
