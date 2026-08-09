import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountActions } from "@/components/account-actions";
import {
  ADMIN_LEVELS,
  BROWSE_LABEL,
  describeGrant,
  tierChipClass,
  type AdminLevel,
} from "@/lib/access-levels";

// Built for the scale this app is heading to (1000+ accounts), not the
// handful it has today: search, filtering and paging all happen in the
// database, so the page never loads more than PAGE_SIZE people at once.
// The panel this replaced loaded every grant and every request in one go —
// fine at 6 accounts, a silent 1000-row truncation at 1000 (see
// feedback_supabase_row_limit).
const PAGE_SIZE = 25;

// Filters are "at least this tier", which maps to a single permission
// containment check the database can answer with an index — unlike
// "exactly browse-only", which would need a NOT EXISTS across user_role and
// can't be expressed through PostgREST embedding at all.
const LEVEL_FILTERS = {
  manager: { label: "Managerowie", permission: "full_access" },
  moderator: { label: "Moderatorzy", permission: "finalize_vote" },
  redaktor: { label: "Redaktorzy", permission: "vote" },
} as const;

type LevelKey = keyof typeof LEVEL_FILTERS;

function isLevelKey(v: string | undefined): v is LevelKey {
  return !!v && v in LEVEL_FILTERS;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildHref(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/admin/konta?${qs}` : "/admin/konta";
}

export default async function AdminKontaPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    poziom?: string;
    stan?: string;
    strona?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isManager } = await supabase.rpc("is_manager", {
    uid: user.id,
  });
  if (!isManager) notFound();

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const levelKey = isLevelKey(sp.poziom) ? sp.poziom : null;
  const onlyPending = sp.stan === "wnioski";
  const page = Math.max(1, Number(sp.strona) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [{ data: councils }, { data: pendingRaw }] = await Promise.all([
    supabase.from("council").select("id, name").order("name"),
    // Pending requests are the only thing on this page with a deadline, so
    // they're fetched in full (bounded by how many people are waiting, not
    // by account count) and shown up top regardless of the active filter.
    supabase
      .from("access_request")
      .select(
        "id, app_user_id, requested_level, scope_council_id, message, created_at, app_user:app_user_id(display_name), council:scope_council_id(name)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range(0, 199),
  ]);

  const councilList = councils ?? [];
  const pending = (pendingRaw ?? []).map((r) => ({
    ...r,
    requesterName: r.app_user?.display_name ?? "Nieznany użytkownik",
    councilName: r.council?.name ?? null,
  }));
  const pendingByUser = new Map<string, typeof pending>();
  for (const r of pending) {
    pendingByUser.set(r.app_user_id, [
      ...(pendingByUser.get(r.app_user_id) ?? []),
      r,
    ]);
  }

  // Two-step fetch on purpose: an `!inner` join needed for the level filter
  // would also restrict the *embedded* user_role rows to the matching ones,
  // hiding a person's other grants in the table. So step 1 asks only "which
  // people match, in what order, and how many are there in total", and step
  // 2 loads the full picture for just that page of ids.
  // The two branches are spelled out rather than sharing one builder with a
  // computed select string: Supabase's types are derived from the *literal*
  // select text, so a runtime-built string collapses the row type to a
  // ParserError and would force an unsafe cast on the result.
  const pendingIds = [...pendingByUser.keys()];
  // An id that matches nothing, for "only pending" with an empty queue —
  // clearer than relying on how PostgREST renders .in([]).
  const NO_MATCH = "00000000-0000-0000-0000-000000000000";

  let idRows: { id: string }[] | null = null;
  let totalCount: number | null = null;

  if (levelKey) {
    let qb = supabase
      .from("app_user")
      .select("id, user_role!inner(permissions)", { count: "exact" })
      .contains("user_role.permissions", [LEVEL_FILTERS[levelKey].permission])
      .order("display_name", { ascending: true })
      .range(from, to);
    if (q) qb = qb.ilike("display_name", `%${q}%`);
    if (onlyPending)
      qb = pendingIds.length ? qb.in("id", pendingIds) : qb.eq("id", NO_MATCH);
    const res = await qb;
    idRows = res.data?.map((r) => ({ id: r.id })) ?? null;
    totalCount = res.count;
  } else {
    let qb = supabase
      .from("app_user")
      .select("id", { count: "exact" })
      .order("display_name", { ascending: true })
      .range(from, to);
    if (q) qb = qb.ilike("display_name", `%${q}%`);
    if (onlyPending)
      qb = pendingIds.length ? qb.in("id", pendingIds) : qb.eq("id", NO_MATCH);
    const res = await qb;
    idRows = res.data;
    totalCount = res.count;
  }

  const pageIds = (idRows ?? []).map((r) => r.id);
  const { data: peopleRaw } = pageIds.length
    ? await supabase
        .from("app_user")
        .select(
          "id, display_name, user_role(id, permissions, scope_council_id, council:scope_council_id(name))"
        )
        .in("id", pageIds)
    : { data: [] };

  // Restore the database's ordering — .in() does not preserve it.
  const byId = new Map((peopleRaw ?? []).map((p) => [p.id, p]));
  const people = pageIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  // Cheap head-only counts for the filter chips; no rows transferred.
  const [allCount, ...levelCounts] = await Promise.all([
    supabase
      .from("app_user")
      .select("id", { count: "exact", head: true })
      .then((r) => r.count ?? 0),
    ...(Object.keys(LEVEL_FILTERS) as LevelKey[]).map((key) =>
      supabase
        .from("app_user")
        .select("id, user_role!inner(permissions)", {
          count: "exact",
          head: true,
        })
        .contains("user_role.permissions", [LEVEL_FILTERS[key].permission])
        .then((r) => r.count ?? 0)
    ),
  ]);
  const countByLevel = Object.fromEntries(
    (Object.keys(LEVEL_FILTERS) as LevelKey[]).map((key, i) => [
      key,
      levelCounts[i],
    ])
  ) as Record<LevelKey, number>;

  const total = totalCount ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterBase = { q: q || undefined, stan: onlyPending ? "wnioski" : undefined };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Konta i uprawnienia
        </h1>
        <Link
          href="/dostep"
          className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          twój dostęp →
        </Link>
      </div>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Do rozpatrzenia ({pending.length})
          </h2>
          <ul className="flex flex-col divide-y divide-blue-200 rounded-2xl border border-blue-200 bg-blue-50/50 dark:divide-blue-900 dark:border-blue-900 dark:bg-blue-950/20">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-4 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {r.requesterName}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    prosi o{" "}
                    <strong className="font-medium">
                      {ADMIN_LEVELS[r.requested_level as AdminLevel]?.label ??
                        r.requested_level}
                    </strong>{" "}
                    — {r.councilName ?? "cała platforma"}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatDate(r.created_at)}
                  </span>
                </div>
                {r.message && (
                  <p className="text-xs text-zinc-500">„{r.message}”</p>
                )}
                <AccountActions
                  mode="request"
                  appUserId={r.app_user_id}
                  councils={councilList}
                  request={{
                    id: r.id,
                    requestedLevel: r.requested_level,
                    scopeCouncilId: r.scope_council_id,
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <form method="GET" action="/admin/konta" className="flex flex-1 gap-2">
            {onlyPending && <input type="hidden" name="stan" value="wnioski" />}
            {levelKey && <input type="hidden" name="poziom" value={levelKey} />}
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Szukaj po nazwisku…"
              className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
            />
            <button
              type="submit"
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Szukaj
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildHref({ ...filterBase })}
            prefetch={false}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              !levelKey
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            Wszyscy ({allCount})
          </Link>
          {(Object.keys(LEVEL_FILTERS) as LevelKey[]).map((key) => (
            <Link
              key={key}
              href={buildHref({ ...filterBase, poziom: key })}
              prefetch={false}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                levelKey === key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {LEVEL_FILTERS[key].label} ({countByLevel[key]})
            </Link>
          ))}
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <Link
            href={buildHref({
              q: q || undefined,
              poziom: levelKey ?? undefined,
              stan: onlyPending ? undefined : "wnioski",
            })}
            prefetch={false}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              onlyPending
                ? "bg-blue-600 text-white"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            Z wnioskiem ({pending.length})
          </Link>
          {(q || levelKey || onlyPending) && (
            <Link
              href="/admin/konta"
              prefetch={false}
              className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Wyczyść
            </Link>
          )}
        </div>

        {people.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
            Nie znaleziono kont dla tych kryteriów.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full border-collapse text-sm">
              <caption className="sr-only">
                Konta użytkowników wraz z nadanymi poziomami dostępu
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border-b border-zinc-200 p-3 text-left font-normal text-zinc-500 dark:border-zinc-800"
                  >
                    Osoba
                  </th>
                  <th
                    scope="col"
                    className="border-b border-zinc-200 p-3 text-left font-normal text-zinc-500 dark:border-zinc-800"
                  >
                    Poziom
                  </th>
                  <th
                    scope="col"
                    className="border-b border-zinc-200 p-3 text-left font-normal text-zinc-500 dark:border-zinc-800"
                  >
                    Zakres
                  </th>
                  <th
                    scope="col"
                    className="border-b border-zinc-200 p-3 text-right font-normal text-zinc-500 dark:border-zinc-800"
                  >
                    Zarządzaj
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const grants = p.user_role ?? [];
                  // The auto-granted browse-only row is the baseline every
                  // account gets on first login — shown as a plain chip, not
                  // as an editable grant, because ADMIN_LEVELS has no entry
                  // for it and an edit dropdown would mismatch it against
                  // Redaktor.
                  const tiers = grants.filter(
                    (g) => !(g.permissions.length === 1 && g.permissions[0] === "browse")
                  );
                  // Level and scope render as two separate columns, so both
                  // iterate this one array — that's what guarantees row N of
                  // "Poziom" lines up with row N of "Zakres" for someone
                  // holding several grants.
                  const browseScope = grants.find(
                    (g) => g.permissions.length === 1 && g.permissions[0] === "browse"
                  )?.council?.name;
                  const displayRows =
                    tiers.length > 0
                      ? tiers.map((g) => ({
                          key: g.id,
                          label: describeGrant(g.permissions) ?? "—",
                          scope: g.council?.name ?? "cała platforma",
                        }))
                      : [
                          {
                            key: "browse",
                            label: BROWSE_LABEL,
                            scope: browseScope ?? "cała platforma",
                          },
                        ];
                  const isSelf = p.id === user.id;
                  const personPending = pendingByUser.get(p.id) ?? [];
                  return (
                    <tr
                      key={p.id}
                      className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <th
                        scope="row"
                        className="border-b border-zinc-100 p-3 text-left font-normal dark:border-zinc-900"
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {p.display_name ?? "Nieznany użytkownik"}
                        </span>
                        {isSelf && (
                          <span className="ml-1 text-zinc-400">(Ty)</span>
                        )}
                        {personPending.length > 0 && (
                          <span className="ml-2 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                            wniosek
                          </span>
                        )}
                      </th>
                      <td className="border-b border-zinc-100 p-3 dark:border-zinc-900">
                        <ul className="flex flex-col gap-1">
                          {displayRows.map((r) => (
                            <li key={r.key} className="flex h-5 items-center">
                              <span className={tierChipClass(r.label)}>
                                {r.label}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="border-b border-zinc-100 p-3 dark:border-zinc-900">
                        <ul className="flex flex-col gap-1">
                          {displayRows.map((r) => (
                            <li key={r.key} className="flex h-5 items-center">
                              <span className="whitespace-nowrap text-xs text-zinc-500">
                                {r.scope}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="border-b border-zinc-100 p-3 text-right dark:border-zinc-900">
                        {isSelf ? (
                          <span className="text-xs text-zinc-400">
                            własne konto
                          </span>
                        ) : (
                          <AccountActions
                            mode="grants"
                            appUserId={p.id}
                            councils={councilList}
                            grants={tiers.map((g) => ({
                              id: g.id,
                              permissions: g.permissions,
                              scopeCouncilId: g.scope_council_id,
                              councilName: g.council?.name ?? null,
                            }))}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            {total === 0
              ? "Brak wyników"
              : `${from + 1}–${Math.min(to + 1, total)} z ${total}`}
          </span>
          <span className="flex items-center gap-2">
            {page > 1 && (
              <Link
                href={buildHref({
                  q: q || undefined,
                  poziom: levelKey ?? undefined,
                  stan: onlyPending ? "wnioski" : undefined,
                  strona: String(page - 1),
                })}
                prefetch={false}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                ← Poprzednia
              </Link>
            )}
            {page < lastPage && (
              <Link
                href={buildHref({
                  q: q || undefined,
                  poziom: levelKey ?? undefined,
                  stan: onlyPending ? "wnioski" : undefined,
                  strona: String(page + 1),
                })}
                prefetch={false}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Następna →
              </Link>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
