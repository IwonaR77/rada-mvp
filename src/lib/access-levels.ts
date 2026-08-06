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

// Best-effort label for whatever a user_role row's permissions[] actually
// contain — used to describe an existing grant, not to request one.
export function describeGrant(permissions: string[]): string | null {
  if (permissions.includes("full_access")) return "Manager (pełny dostęp)";
  if (permissions.includes("finalize_vote")) return ACCESS_LEVELS.moderator.label;
  if (permissions.includes("vote")) return ACCESS_LEVELS.editor.label;
  return permissions.length > 0 ? permissions.join(", ") : null;
}
