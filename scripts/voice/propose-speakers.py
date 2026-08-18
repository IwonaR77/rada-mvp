#!/usr/bin/env python3
"""
Wpisuje rozpoznanych głosem mówców do bazy — zawsze jako PROPOZYCJE.

`status = 'proposed'`, nigdy `finalized`: dokładnie tak, jak propozycje
z protokołów (`scripts/match-protokol-speakers.py`). Nazwisko przy cudzej
wypowiedzi to zniesławienie, więc ostatnie słowo ma człowiek.

Rusza wyłącznie segmenty ze statusem `open` i bez mówcy. Zatwierdzonych nie
dotyka, cudzych propozycji też nie — podmiana jednej hipotezy na drugą bez
niczyjej decyzji byłaby cichą utratą informacji.

Trzy warunki naraz, wszystkie muszą być spełnione (patrz evaluate.py):
próg, przewaga nad drugim kandydatem i zgoda obu modeli. Gdy którykolwiek
nie przechodzi, segment zostaje bez przypisania — brak danych jest tańszy
niż pomyłka.

Domyślne progi (0,70 / 0,05) pochodzą z kontroli na sesji 86312 i zakładają,
że embeddingi policzono TAK SAMO jak wzorce (`--z-sieci`). Materiał z innego
źródła przesuwa całą skalę o ~0,1 — patrz notatki/identyfikacja-mowcy-glosem.

Użycie:
  python scripts/voice/propose-speakers.py --rejestr groq/work/glos/rejestr.npz \
      --emb groq/work/glos/emb-52314.npz --esesja 52314 [--zapisz]
"""

import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]


def sb_query(sql, proby=3):
    ostatni = None
    for nr in range(proby):
        r = subprocess.run(["npx", "supabase", "db", "query", "--linked", sql],
                           capture_output=True, text=True, cwd=REPO_ROOT, timeout=90)
        i = r.stdout.find("{")
        if i == -1:
            ostatni = f"zapytanie nie wyszło: {r.stdout} {r.stderr}"
        else:
            try:
                dane = json.loads(r.stdout[i:])
                if "rows" in dane:
                    return dane["rows"]
                ostatni = f"błąd API: {dane}"
            except json.JSONDecodeError:
                ostatni = f"zły json: {r.stdout[i:i + 300]}"
        time.sleep(2 * (nr + 1))
    raise RuntimeError(ostatni)


def sb_apply(sciezka):
    r = subprocess.run(["npx", "supabase", "db", "query", "--linked", "-f", str(sciezka)],
                       capture_output=True, text=True, cwd=REPO_ROOT, timeout=300)
    print(r.stdout)
    if r.returncode != 0:
        raise RuntimeError(f"zapis nie wyszedł: {r.stdout} {r.stderr}")


def wczytaj_osoby():
    """Nazwisko -> (kolumna, id). Radni i urzędnicy siedzą w osobnych tabelach."""
    osoby = {}
    for row in sb_query("select id, full_name from councilor"):
        osoby[row["full_name"]] = ("confirmed_councilor_id", row["id"])
    for row in sb_query("select id, full_name from official"):
        # Radny ma pierwszeństwo: gdy ktoś jest w obu tabelach, wypowiada się
        # jako radny, a wpis w `official` opisuje jego funkcję.
        osoby.setdefault(row["full_name"], ("confirmed_official_id", row["id"]))
    return osoby


def decyzje(emb, centroidy, osoby, prog, przewaga):
    out = {}
    for sid, e in emb.items():
        sim = centroidy @ e
        k = np.argsort(-sim)
        best = float(sim[k[0]])
        drugi = float(sim[k[1]]) if len(sim) > 1 else -1.0
        out[sid] = (osoby[k[0]], best) if (best >= prog and best - drugi >= przewaga) \
            else (None, best)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rejestr", required=True)
    p.add_argument("--emb", required=True)
    p.add_argument("--esesja", required=True)
    p.add_argument("--modele", default="resnet34,ecapa")
    p.add_argument("--prog", type=float, default=0.70)
    p.add_argument("--przewaga", type=float, default=0.05)
    p.add_argument("--zapisz", action="store_true", help="wykonaj SQL na bazie")
    p.add_argument("--nadpisz-propozycje", action="store_true",
                   help="rusz także segmenty ze statusem `proposed` (cudze hipotezy)")
    args = p.parse_args()

    modele = args.modele.split(",")
    rej = np.load(args.rejestr, allow_pickle=True)
    dane = np.load(args.emb, allow_pickle=True)

    wg_modelu = {}
    for m in modele:
        if f"centroidy_{m}" not in rej or f"emb_{m}" not in dane:
            raise SystemExit(f"Brak modelu {m} w rejestrze albo w embeddingach.")
        emb = {str(i): e for i, e in zip(dane[f"ids_{m}"], dane[f"emb_{m}"])}
        wg_modelu[m] = decyzje(emb, rej[f"centroidy_{m}"],
                               [str(x) for x in rej[f"osoby_{m}"]],
                               args.prog, args.przewaga)

    wspolne = set.intersection(*[set(d) for d in wg_modelu.values()])
    przypisane, wstrzymane, niezgodne = {}, 0, 0
    for sid in wspolne:
        wskazania = [wg_modelu[m][sid][0] for m in modele]
        if None in wskazania:
            wstrzymane += 1
        elif len(set(wskazania)) > 1:
            niezgodne += 1
        else:
            przypisane[sid] = (wskazania[0],
                               min(wg_modelu[m][sid][1] for m in modele))

    print(f"Segmentów policzonych: {len(wspolne)}")
    print(f"  rozpoznanych:  {len(przypisane)}")
    print(f"  wstrzymanych:  {wstrzymane} (za nisko / bez przewagi)")
    print(f"  niezgodnych:   {niezgodne} (modele wskazały różne osoby)")

    if not przypisane:
        return

    ile = {}
    for osoba, _ in przypisane.values():
        ile[osoba] = ile.get(osoba, 0) + 1
    print("\nKto i ile:")
    for osoba, n in sorted(ile.items(), key=lambda kv: -kv[1]):
        print(f"  {osoba:32} {n:4}")

    osoby_db = wczytaj_osoby()
    brakujacy = sorted({o for o, _ in przypisane.values() if o not in osoby_db})
    if brakujacy:
        raise SystemExit(f"Nie znalazłem w bazie: {brakujacy}")

    # Zatwierdzone przypisania są nietykalne w obu trybach — to jedyna wiedza
    # potwierdzona przez człowieka. Różnica dotyczy wyłącznie cudzych
    # PROPOZYCJI (np. z dopasowania protokołów): domyślnie ich nie ruszamy,
    # z `--nadpisz-propozycje` traktujemy je jak wolne miejsce.
    dozwolone = "('open', 'proposed')" if args.nadpisz_propozycje else "('open')"
    warunek = (
        f"status in {dozwolone}"
        if args.nadpisz_propozycje
        else "status = 'open' and confirmed_councilor_id is null "
             "and confirmed_official_id is null"
    )

    linie = ["-- Propozycje mówców z rozpoznawania głosem "
             f"(sesja {args.esesja}, próg {args.prog}, przewaga {args.przewaga}).",
             f"-- Ruszane statusy: {dozwolone}; status ustawiany na `proposed`."]
    for sid, (osoba, _) in sorted(przypisane.items()):
        kolumna, oid = osoby_db[osoba]
        # Druga kolumna czyszczona jawnie: przy nadpisywaniu cudzej propozycji
        # mówca mógł tam siedzieć jako radny, a my wskazujemy urzędnika (albo
        # odwrotnie) — zostawiony stary klucz dałby segment z dwoma mówcami.
        inna = ("confirmed_official_id" if kolumna == "confirmed_councilor_id"
                else "confirmed_councilor_id")
        linie.append(
            f"update segment set {kolumna} = '{oid}', {inna} = null, "
            f"status = 'proposed' where id = '{sid}' and {warunek};")

    if args.nadpisz_propozycje:
        # Sprzątanie po cudzej hipotezie: propozycje, których głos NIE
        # potwierdził, znikają razem z zapisem nowych. Zostawianie ich było
        # gorsze niż bezużyteczne — sesja wyglądała potem na w pełni
        # rozpisaną, a „zatwierdź wszystkie" przyjmowało jednym kliknięciem
        # przypisania z dwóch źródeł o zupełnie różnej wiarygodności.
        linie.append(
            f"update segment s set confirmed_councilor_id = null, "
            f"confirmed_official_id = null, status = 'open' "
            f"from meeting m where m.id = s.meeting_id "
            f"and m.esesja_id = '{args.esesja}' and s.status = 'proposed' "
            f"and s.id not in (" +
            ",".join(f"'{sid}'" for sid in sorted(przypisane)) + ");")

    sql = Path(f"/tmp/propozycje-glos-{args.esesja}.sql")
    sql.write_text("\n".join(linie) + "\n", encoding="utf8")
    print(f"\nSQL: {sql}")
    if args.zapisz:
        sb_apply(sql)
    else:
        print("To był przebieg na sucho. Zapis: --zapisz")


if __name__ == "__main__":
    main()
