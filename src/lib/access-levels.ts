// The two self-service-requestable tiers, mapped to the permission strings
// user_has_permission() actually checks (src/app/sesje/[id]/page.tsx,
// src/app/sprawy/actions.ts). app_user.role ('admin'/'moderator', which
// unlocks raw transcript import/split) is intentionally not offered here —
// too destructive for a self-service request, stays DB-manual like today.
export const ACCESS_LEVELS = {
  editor: {
    label: "Redaktor",
    description:
      "Może proponować przypisanie mówcy do wypowiedzi w transkrypcjach sesji.",
    permissions: ["vote"],
  },
  moderator: {
    label: "Moderator",
    description:
      "Może zatwierdzać przypisania mówców i sprawy oraz pobierać transkrypty (.txt/.srt).",
    permissions: ["vote", "finalize_vote", "download_txt_srt"],
  },
} as const;

export type AccessLevel = keyof typeof ACCESS_LEVELS;

// Shared between the request form (maxLength) and the server action
// (authoritative check) — access_request.message is an unbounded `text`
// column with no DB-level constraint.
export const MESSAGE_MAX_LENGTH = 2000;

export function isAccessLevel(value: string): value is AccessLevel {
  return value in ACCESS_LEVELS;
}

// Superset of ACCESS_LEVELS for the manager-facing edit UI (grant/edit an
// existing user_role row) — includes "manager" itself, unlike ACCESS_LEVELS
// which only lists what's safe to offer as a self-service request.
export const ADMIN_LEVELS = {
  ...ACCESS_LEVELS,
  manager: {
    label: "Manager (pełny dostęp)",
    description:
      "Pełny dostęp administracyjny, w tym zarządzanie uprawnieniami innych osób.",
    permissions: ["full_access"],
  },
} as const;

export type AdminLevel = keyof typeof ADMIN_LEVELS;

export function isAdminLevel(value: string): value is AdminLevel {
  return value in ADMIN_LEVELS;
}

// The "browse" permission is auto-granted to every account on first login
// (see grant_browse_permission(), called from /auth/callback) — it's not a
// self-service-requestable tier like ACCESS_LEVELS, just the baseline that
// makes describeGrant() return a real label instead of the raw string
// "browse" for someone who hasn't requested anything yet.
export const BROWSE_LABEL = "Przeglądanie";

// Best-effort label for whatever a user_role row's permissions[] actually
// contain — used to describe an existing grant, not to request one.
export function describeGrant(permissions: string[]): string | null {
  if (permissions.includes("full_access")) return "Manager (pełny dostęp)";
  if (permissions.includes("finalize_vote")) return ACCESS_LEVELS.moderator.label;
  if (permissions.includes("vote")) return ACCESS_LEVELS.editor.label;
  if (permissions.includes("browse")) return BROWSE_LABEL;
  return permissions.length > 0 ? permissions.join(", ") : null;
}

// Which self-service ACCESS_LEVELS tiers a user already effectively holds
// (their granted permissions, pooled across all scopes, already cover that
// tier's requirements) — used to stop e.g. an existing Moderator from
// requesting Redaktor or Moderator again.
export function alreadyHeldLevels(permissions: string[]): AccessLevel[] {
  return (Object.keys(ACCESS_LEVELS) as AccessLevel[]).filter((level) =>
    ACCESS_LEVELS[level].permissions.every(
      (p) => permissions.includes(p) || permissions.includes("full_access")
    )
  );
}
