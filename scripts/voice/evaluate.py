#!/usr/bin/env python3
"""
Ocena rozpoznawania mówcy na sesjach ROZŁĄCZNYCH z tymi, z których zbudowano
rejestr — i dobór progów.

Zasada: błędna identyfikacja jest znacznie gorsza niż brak identyfikacji, więc
nie szukamy najlepszej „skuteczności", tylko najszerszego pokrycia PRZY ZERZE
pomyłek. Stąd trzy niezależne warunki, wszystkie muszą być spełnione naraz:

  próg      — podobieństwo do najbliższego wzorca musi je przekroczyć;
  przewaga  — musi odstawać od drugiego kandydata; sam próg nie wystarcza, bo
              dwa podobne głosy potrafią oba go przekroczyć, a wtedy wybór
              między nimi jest rzutem monetą;
  zgoda     — oba modele (resnet34 i CAM++, różne architektury) muszą wskazać
              tę samą osobę; mylą się w różnych miejscach, więc pomyłka
              musiałaby zdarzyć się dwa razy naraz.

Najważniejsza część testu to segmenty, których mówcy NIE MA w rejestrze —
goście, mieszkańcy, osoby z za małą ilością nagrania. Tam każde przypisanie
jest z definicji błędem, a to najczęstsza droga do pomyłki w realnym biegu:
system nie ma opcji „to ktoś obcy", więc wybiera najbliższego znajomego.

Użycie:
  python scripts/voice/evaluate.py --groundtruth ... --rejestr ... \
      --emb-dir groq/work/glos --sesje 82474,83096 [--siatka]
"""

import argparse
import json
from pathlib import Path

import numpy as np

ETYKIETY_ZBIORCZE = {
    "Zaproszony gość",
    "Mieszkaniec miasta",
    "Nieustalony mówca",
    "Nieustalony urzędnik",
}


def wczytaj_emb(emb_dir, sesje, model):
    out = {}
    for s in sesje:
        plik = Path(emb_dir) / f"emb-{s}.npz"
        if not plik.exists():
            continue
        d = np.load(plik, allow_pickle=True)
        if f"emb_{model}" not in d:
            continue
        for i, e in zip(d[f"ids_{model}"], d[f"emb_{model}"]):
            out[str(i)] = e
    return out


def decyzje(emb, centroidy, osoby, prog, przewaga):
    """id -> (osoba, podobieństwo) albo (None, podobieństwo) przy wstrzymaniu."""
    out = {}
    for sid, e in emb.items():
        sim = centroidy @ e
        kolejnosc = np.argsort(-sim)
        best, drugi = sim[kolejnosc[0]], (sim[kolejnosc[1]] if len(sim) > 1 else -1.0)
        if best >= prog and (best - drugi) >= przewaga:
            out[sid] = (osoby[kolejnosc[0]], float(best))
        else:
            out[sid] = (None, float(best))
    return out


def ocen(gt_wg_id, decyzje_wg_modelu, w_rejestrze, wymagaj_zgody=True):
    """Zwraca (poprawne, bledy, wstrzymane, lista_bledow)."""
    modele = list(decyzje_wg_modelu.keys())
    wspolne = set.intersection(*[set(d.keys()) for d in decyzje_wg_modelu.values()])
    poprawne = bledy = wstrzymane = 0
    lista_bledow = []

    for sid in wspolne:
        wskazania = [decyzje_wg_modelu[m][sid][0] for m in modele]
        if wymagaj_zgody:
            wybor = wskazania[0] if len(set(wskazania)) == 1 else None
        else:
            wybor = wskazania[0]

        prawda = gt_wg_id[sid]["mowca"]
        prawda_znana = prawda in w_rejestrze and prawda not in ETYKIETY_ZBIORCZE

        if wybor is None:
            wstrzymane += 1
        elif prawda_znana and wybor == prawda:
            poprawne += 1
        else:
            bledy += 1
            lista_bledow.append({
                "id": sid,
                "prawda": prawda,
                "wybor": wybor,
                "spoza_rejestru": not prawda_znana,
                "sim": max(decyzje_wg_modelu[m][sid][1] for m in modele),
                "esesja": gt_wg_id[sid]["esesja_id"],
                "start": gt_wg_id[sid]["start"],
            })
    return poprawne, bledy, wstrzymane, lista_bledow


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--groundtruth", required=True)
    p.add_argument("--rejestr", required=True)
    p.add_argument("--emb-dir", required=True)
    p.add_argument("--sesje", required=True, help="sesje testowe, po przecinku")
    p.add_argument("--modele", default="resnet34,campplus")
    p.add_argument("--siatka", action="store_true", help="przemiataj progi")
    p.add_argument("--prog", type=float, default=0.55)
    p.add_argument("--przewaga", type=float, default=0.10)
    p.add_argument("--bez-zgody", action="store_true")
    args = p.parse_args()

    sesje_test = args.sesje.split(",")
    modele = args.modele.split(",")
    rej = np.load(args.rejestr, allow_pickle=True)
    sesje_wzorcowe = set(str(x) for x in rej["sesje_wzorcowe"])

    nachodzace = sesje_wzorcowe & set(sesje_test)
    if nachodzace:
        raise SystemExit(
            f"Sesje {sorted(nachodzace)} są jednocześnie wzorcowe i testowe — "
            f"taki test mierzy zapamiętywanie, nie rozpoznawanie. Przerywam."
        )

    gt = json.load(open(args.groundtruth))["segmenty"]
    gt_wg_id = {s["id"]: s for s in gt if s["esesja_id"] in sesje_test}

    dane = {}
    for m in modele:
        if f"centroidy_{m}" not in rej:
            print(f"Rejestr nie ma modelu {m} — pomijam")
            continue
        emb = wczytaj_emb(args.emb_dir, sesje_test, m)
        emb = {k: v for k, v in emb.items() if k in gt_wg_id}
        dane[m] = (emb, rej[f"centroidy_{m}"], [str(x) for x in rej[f"osoby_{m}"]])
        print(f"{m}: {len(emb)} segmentów testowych, {len(dane[m][2])} osób w rejestrze")

    if not dane:
        raise SystemExit("Brak modeli do oceny.")

    w_rejestrze = set(dane[modele[0]][2])
    ile_spoza = sum(
        1 for sid in dane[modele[0]][0]
        if gt_wg_id[sid]["mowca"] not in w_rejestrze or gt_wg_id[sid]["mowca"] in ETYKIETY_ZBIORCZE
    )
    print(f"Segmentów, których mówcy nie ma w rejestrze (muszą się wstrzymać): {ile_spoza}")

    siatka = (
        [(pr, pw) for pr in np.arange(0.40, 0.76, 0.05) for pw in np.arange(0.00, 0.26, 0.05)]
        if args.siatka else [(args.prog, args.przewaga)]
    )

    print(f"\n{'próg':>6} {'przew':>6} {'popr':>6} {'BŁĘDY':>6} {'wstrz':>6} {'pokrycie':>9}")
    najlepsze = None
    for prog, przewaga in siatka:
        d = {m: decyzje(e, c, o, prog, przewaga) for m, (e, c, o) in dane.items()}
        popr, bledy, wstrz, lista = ocen(gt_wg_id, d, w_rejestrze, not args.bez_zgody)
        razem = popr + bledy + wstrz
        pokrycie = (popr + bledy) / razem if razem else 0
        print(f"{prog:6.2f} {przewaga:6.2f} {popr:6d} {bledy:6d} {wstrz:6d} {pokrycie:8.1%}")
        if bledy == 0 and (najlepsze is None or popr > najlepsze[2]):
            najlepsze = (prog, przewaga, popr, pokrycie)
        if not args.siatka and lista:
            print("\nBŁĘDY:")
            for b in sorted(lista, key=lambda x: -x["sim"])[:25]:
                skad = "SPOZA REJESTRU" if b["spoza_rejestru"] else "inna osoba"
                print(f"  sim={b['sim']:.3f} {skad:15} prawda={b['prawda']:28} "
                      f"wybór={b['wybor']:28} sesja={b['esesja']} t={b['start']:.0f}s")

    if args.siatka:
        if najlepsze:
            print(f"\nNajszersze pokrycie przy ZERZE błędów: "
                  f"próg={najlepsze[0]:.2f} przewaga={najlepsze[1]:.2f} "
                  f"→ {najlepsze[2]} trafień, pokrycie {najlepsze[3]:.1%}")
        else:
            print("\nŻaden punkt siatki nie dał zera błędów.")


if __name__ == "__main__":
    main()
