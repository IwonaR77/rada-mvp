// Dostęp do bazy z poziomu skryptów CLI.
//
// Wydzielone, bo ten sam kod istniał dotąd w pięciu kopiach (discover-new-sessions,
// import-transcript, groq/pipeline-groq, whisper/*). Nowe skrypty powiatowe byłyby
// szóstą i siódmą. groq/ świadomie zostaje samodzielne — ma być przenośne razem
// z workflow — więc ten moduł obsługuje wyłącznie skrypty z scripts/.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Wykonuje SELECT i zwraca tablicę wierszy jako obiekty.
 *
 * `npx supabase db query --linked` zależy od keyringu/D-Bus sesji desktopowej,
 * niedostępnej headless (GitHub Actions). SUPABASE_DB_URL (repo secret w CI)
 * → bezpośrednie psql. Dzięki temu cały pipeline potrzebuje jednego sekretu,
 * bez osobnego klucza service_role.
 */
export function supabaseQuery(sql) {
  if (process.env.SUPABASE_DB_URL) {
    const wrapped = `select coalesce(json_agg(row_to_json(sub)), '[]'::json) from (${sql.replace(/;\s*$/, "")}) sub;`;
    const out = execFileSync(
      "psql",
      [process.env.SUPABASE_DB_URL, "-t", "-A", "-c", wrapped],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return JSON.parse(out.trim() || "[]");
  }
  try {
    const out = execFileSync(
      "npx",
      ["supabase", "db", "query", "--linked", "--output", "json", sql],
      // Pięć minut, nie trzydzieści sekund: zrzut przypisań mówców liczy
      // okna (lag/lead) po wszystkich segmentach i przy kilkunastu tysiącach
      // zatwierdzeń przestał się mieścić w dawnym limicie. Limit ma chronić
      // przed zawieszeniem, a nie ucinać poprawne, po prostu dłuższe zapytania.
      // maxBuffer: domyślny 1 MB wystarczał, dopóki zapytania zwracały setki
      // wierszy. Zrzut przypisań mówców to dziś ponad 16 tys. wierszy i kilka
      // MB JSON-a — po przekroczeniu bufora Node zabija proces, a błąd wygląda
      // jak uszkodzona odpowiedź bazy, nie jak limit po naszej stronie.
      {
        encoding: "utf8",
        cwd: REPO_ROOT,
        timeout: 300000,
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    return JSON.parse(out).rows ?? [];
  } catch (e) {
    // Telemetria CLI potrafi zwrócić kod ≠ 0 mimo poprawnego wyniku na stdout.
    const stdout = e.stdout?.toString() ?? "";
    try {
      return JSON.parse(stdout).rows ?? [];
    } catch {
      throw e;
    }
  }
}

/** Wykonuje polecenie nie zwracające wierszy (insert/update). */
export function supabaseExec(sql) {
  if (process.env.SUPABASE_DB_URL) {
    execFileSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
      encoding: "utf8",
    });
    return;
  }
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 30000,
  });
}

export function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

/** Literał SQL: string w apostrofach albo NULL. */
export function sqlText(s) {
  return s == null ? "null" : `'${sqlEscape(s)}'`;
}

export { REPO_ROOT };
