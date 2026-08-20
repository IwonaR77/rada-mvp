#!/usr/bin/env python3
"""
Buduje rejestr głosów: po jednym wzorcu (centroidzie) na osobę, z próbek
rozrzuconych po różnych sesjach i po odległych momentach każdej sesji.

Dlaczego rozrzut, a nie „N kolejnych segmentów": wzorzec zbudowany z jednego
fragmentu jednej sesji zapamiętuje ten dzień — ustawienie mikrofonu, chrypkę,
tempo — a nie osobę. Przy dopasowaniu do innej sesji taki wzorzec albo milczy,
albo (gorzej) trafia w kogoś innego nagranego w podobnych warunkach.

Etykiety zbiorcze („Zaproszony gość", „Mieszkaniec miasta", „Nieustalony
mówca", „Nieustalony urzędnik") nie mają tu wstępu — pod każdą kryje się za
każdym razem inna osoba, więc ich „wzorzec" byłby średnią przypadkowych ludzi
i psułby wszystko, do czego jest podobny.

Rejestr zapamiętuje, z których sesji wziął próbki. Ocena musi testować na
sesjach rozłącznych z tym zbiorem — inaczej mierzy zapamiętywanie, nie
rozpoznawanie.

Użycie:
  python scripts/voice/build-register.py \
      --groundtruth groq/work/glos/groundtruth.json \
      --emb-dir groq/work/glos --sesje 76234,78623,80283 \
      --out groq/work/glos/rejestr.npz
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ETYKIETY_ZBIORCZE = {
    "Zaproszony gość",
    "Mieszkaniec miasta",
    "Nieustalony mówca",
    "Nieustalony urzędnik",
    # Tekst bez pokrycia w nagraniu (halucynacja rozpoznawania mowy) —
    # pod spodem jest cisza albo szum, więc wzorzec byłby wzorcem szumu.
    "Halucynacja transkrypcji",
}

MIN_CZAS_WZORCA = 4.0
MIN_PROBEK = 8


def plik_sesji(emb_dir, sesja):
    """Ścieżka do embeddingów sesji: pełny zrzut ma pierwszeństwo.

    Historycznie jedna sesja mogła dać dwa pliki: `emb-<id>.npz` — kilkanaście
    próbek wyciętych pod wzorce, gdy prawie nic nie było jeszcze zatwierdzone —
    i `emb-<id>-sesja.npz` — komplet segmentów, liczony później pod tagowanie.
    Dziś, gdy przypisania nadrobiono, ten drugi opisuje tę samą sesję pełniej,
    a przy okazji pochodzi z HLS-a, czyli z tego samego źródła co reszta.
    Mieszanie źródeł przesuwa całą skalę podobieństw o ~0,1, więc bierzemy
    jeden plik na sesję, nie sumę obu.
    """
    pelny = Path(emb_dir) / f"emb-{sesja}-sesja.npz"
    return pelny if pelny.exists() else Path(emb_dir) / f"emb-{sesja}.npz"


def wczytaj_embeddingi(emb_dir, sesje, model):
    """id segmentu -> embedding, ze wszystkich .npz podanych sesji."""
    out = {}
    for s in sesje:
        plik = plik_sesji(emb_dir, s)
        if not plik.exists():
            print(f"  UWAGA: brak {plik}, pomijam sesję {s}")
            continue
        d = np.load(plik, allow_pickle=True)
        klucz_id, klucz_emb = f"ids_{model}", f"emb_{model}"
        if klucz_emb not in d:
            print(f"  UWAGA: {plik} nie ma modelu {model}")
            continue
        for i, e in zip(d[klucz_id], d[klucz_emb]):
            out[str(i)] = e
    return out


def rozrzuc(segmenty, ile):
    """Wybiera `ile` próbek maksymalnie rozstawionych w czasie sesji."""
    if len(segmenty) <= ile:
        return segmenty
    segmenty = sorted(segmenty, key=lambda s: s["start"])
    idx = np.linspace(0, len(segmenty) - 1, ile).round().astype(int)
    return [segmenty[i] for i in sorted(set(idx))]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--groundtruth", required=True)
    p.add_argument("--emb-dir", required=True)
    p.add_argument("--sesje", required=True, help="sesje wzorcowe, po przecinku")
    p.add_argument("--out", required=True)
    p.add_argument("--modele", default="resnet34,campplus")
    p.add_argument("--na-sesje", type=int, default=6, help="ile próbek z jednej sesji")
    args = p.parse_args()

    sesje_wzorcowe = args.sesje.split(",")
    modele = args.modele.split(",")
    gt = json.load(open(args.groundtruth))["segmenty"]

    # kandydaci na wzorzec: czyste, długie, realna osoba, z sesji wzorcowych
    kandydaci = defaultdict(lambda: defaultdict(list))
    for s in gt:
        if s["zbiorcza"] or s["mowca"] in ETYKIETY_ZBIORCZE:
            continue
        if s["esesja_id"] not in sesje_wzorcowe:
            continue
        if not s["czysty"] or (s["end"] - s["start"]) < MIN_CZAS_WZORCA:
            continue
        kandydaci[s["mowca"]][s["esesja_id"]].append(s)

    rejestr = {}
    for model in modele:
        print(f"Model {model}:")
        emb = wczytaj_embeddingi(args.emb_dir, sesje_wzorcowe, model)
        if not emb:
            print("  brak embeddingów, pomijam")
            continue
        centroidy, osoby, meta = [], [], {}
        for osoba, wg_sesji in sorted(kandydaci.items()):
            wybrane = []
            for sesja, segs in wg_sesji.items():
                # Najpierw odsiewamy segmenty bez policzonego embeddingu, dopiero
                # potem rozrzucamy. Odwrotna kolejność potrafiła wybrać sześć
                # próbek rozstawionych po sesji i zostać z jedną — ekstrakcja
                # liczy tylko część segmentów (--na-osobe, --min-czas), więc
                # „równo po sesji" trzeba mierzyć na tym, co faktycznie mamy.
                policzone = [s for s in segs if s["id"] in emb]
                wybrane += rozrzuc(policzone, args.na_sesje)
            if len(wybrane) < MIN_PROBEK or len(wg_sesji) < 2:
                continue
            wektory = np.stack([emb[s["id"]] for s in wybrane])
            c = wektory.mean(axis=0)
            c /= np.linalg.norm(c)
            centroidy.append(c.astype(np.float32))
            osoby.append(osoba)
            meta[osoba] = {"probek": len(wybrane), "sesji": len(wg_sesji)}
        rejestr[f"centroidy_{model}"] = np.stack(centroidy)
        rejestr[f"osoby_{model}"] = np.array(osoby, dtype=object)
        print(f"  {len(osoby)} osób we wzorcach")
        for o in osoby:
            print(f"    {o:32} {meta[o]['probek']:3} próbek z {meta[o]['sesji']} sesji")

    rejestr["sesje_wzorcowe"] = np.array(sesje_wzorcowe, dtype=object)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **rejestr)
    print(f"\nZapisano rejestr: {args.out}")


if __name__ == "__main__":
    main()
