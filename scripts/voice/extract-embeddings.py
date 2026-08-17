#!/usr/bin/env python3
"""
Liczy embeddingi głosu dla segmentów jednej sesji i zapisuje do .npz.

Dekodowanie blokami po ~10 min, nie osobnym ffmpegiem na segment: przy 1300
segmentach sam narzut uruchamiania procesu przewyższał liczenie. Całej sesji
też nie wczytujemy naraz — 2,5 h w int16 to ~290 MB, a na tej maszynie jest
~1 GB wolnego RAM-u obok onnxruntime.

Dla każdego segmentu liczymy embedding całości oraz — opcjonalnie (--polowki) —
obu połówek osobno. Rozjazd między połówkami zdradza segment z dwoma mówcami:
cięcie idzie po pauzach, nie po zmianach mówcy, więc takie się zdarzają, a to
klasyczne źródło błędnej identyfikacji.

Użycie:
  python scripts/voice/extract-embeddings.py \
      --audio groq/work/audio/72522_2025-08-07.mp3 --esesja 72522 \
      --groundtruth groq/work/glos/groundtruth.json \
      --out groq/work/glos/emb-72522.npz [--polowki] [--min-czas 2.0]

Bez pobranego pliku: `--z-sieci` zamiast `--audio` — wtedy dźwięk leci prosto
z transmisji, kawałek po kawałku, tylko tam gdzie leżą wybrane segmenty
(patrz hls.py). Przy budowie wzorców to rząd wielkości mniej danych niż
ściąganie całej sesji.
"""

import argparse
import json
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embed import Model, fbank, SAMPLE_RATE  # noqa: E402
from hls import DzwiekHls, znajdz_playliste  # noqa: E402

BLOK = 600.0  # sekund na jedno wywołanie ffmpega
MARGINES = 5.0  # zapas na segment przecinający granicę bloku

# CAM++ z WeSpeakera świadomie poza listą: sprawdzony 15.08.2026 na tym samym
# materiale, w trzech wariantach normalizacji cech (CMN / brak / CMVN), za
# każdym razem nie odróżniał mówców (ten sam ~0,51 vs różni ~0,44, przy
# maksimum dla różnych 0,97). To nie kwestia progu — embeddingi z tego pliku
# .onnx są bezużyteczne. resnet34 na tym samym materiale: 0,751 vs 0,167.
#
# W jego miejsce ECAPA-TDNN1024 (voxceleb_ECAPA1024_LM), sprawdzony 16.08.2026
# tym samym testem na sesji 72888: ten sam mówca 0,777 vs różni 0,176
# (resnet34 tam: 0,807 vs 0,167). Inna architektura niż resnet34, więc myli się
# w innych miejscach — o to chodzi przy wymogu zgody obu modeli.
MODELE = {
    "resnet34": "/home/blady/.venv-rada-voice/models/resnet34.onnx",
    "ecapa": "/home/blady/.venv-rada-voice/models/ecapa.onnx",
}


def dekoduj(sciezka, start, dlugosc):
    cmd = [
        "ffmpeg", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", str(sciezka),
        "-t", f"{dlugosc:.3f}", "-f", "s16le", "-acodec", "pcm_s16le",
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
    ]
    surowe = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(surowe, dtype=np.int16)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", help="lokalny plik audio całej sesji")
    p.add_argument("--z-sieci", action="store_true",
                   help="zamiast pliku — pobieraj z transmisji tylko potrzebne kawałki")
    p.add_argument("--esesja", required=True)
    p.add_argument("--groundtruth")
    p.add_argument("--segmenty", help="JSON z listą segmentów, gdy nie z groundtruth")
    p.add_argument("--out", required=True)
    p.add_argument("--polowki", action="store_true")
    p.add_argument("--min-czas", type=float, default=2.0)
    p.add_argument("--modele", default="resnet34")
    p.add_argument("--tylko-czyste", action="store_true",
                   help="tylko segmenty ze środka czyjejś wypowiedzi, realne osoby")
    p.add_argument("--na-osobe", type=int,
                   help="najwyżej tyle segmentów na osobę, rozrzuconych po sesji")
    args = p.parse_args()
    if bool(args.audio) == bool(args.z_sieci):
        raise SystemExit("Podaj albo --audio <plik>, albo --z-sieci.")

    if args.groundtruth:
        dane = json.load(open(args.groundtruth))["segmenty"]
        segs = [s for s in dane if s["esesja_id"] == args.esesja]
    else:
        segs = json.load(open(args.segmenty))["segmenty"]

    segs = [s for s in segs if (s["end"] - s["start"]) >= args.min_czas]
    if args.tylko_czyste:
        segs = [s for s in segs if s.get("czysty") and not s.get("zbiorcza")]
    segs.sort(key=lambda s: s["start"])

    # Sesja wzorcowa nie potrzebuje wszystkich 1900 segmentów — kilka próbek na
    # osobę wystarczy na centroid, a liczenie idzie ~1 segm/s. Rozrzucamy je po
    # całej sesji, bo próbki z jednego kwadransa zapamiętują ten moment
    # (mikrofon, tempo, chrypkę), a nie osobę — patrz build-register.py.
    if args.na_osobe:
        wg_osoby = defaultdict(list)
        for s in segs:
            wg_osoby[s.get("mowca") or s.get("mowca_id")].append(s)
        wybrane = []
        for lista in wg_osoby.values():
            if len(lista) <= args.na_osobe:
                wybrane += lista
            else:
                idx = np.linspace(0, len(lista) - 1, args.na_osobe).round().astype(int)
                wybrane += [lista[i] for i in sorted(set(idx))]
        segs = sorted(wybrane, key=lambda s: s["start"])

    if not segs:
        print("Brak segmentów spełniających warunki.")
        return

    nazwy = args.modele.split(",")
    modele = {n: Model(MODELE[n]) for n in nazwy}
    zrodlo = "z sieci" if args.z_sieci else args.audio
    print(f"{len(segs)} segmentów, modele: {', '.join(nazwy)}, dźwięk: {zrodlo}",
          flush=True)

    wyniki = {n: {} for n in nazwy}
    polowki = {n: {} for n in nazwy}
    start_czas = time.time()
    koniec_sesji = max(s["end"] for s in segs)
    zrobione = 0

    def policz(s, probki):
        nonlocal zrobione
        if probki is None or len(probki) < SAMPLE_RATE * 0.5:
            return
        for n, m in modele.items():
            e = m.embedding(probki)
            if e is not None:
                wyniki[n][s["id"]] = e
            if args.polowki:
                srodek = len(probki) // 2
                a = m.embedding(probki[:srodek])
                b = m.embedding(probki[srodek:])
                if a is not None and b is not None:
                    polowki[n][s["id"]] = np.stack([a, b])
        zrobione += 1
        if zrobione % 25 == 0:
            tempo = zrobione / (time.time() - start_czas)
            print(f"  {zrobione}/{len(segs)} ({tempo:.1f} segm/s)", flush=True)

    if args.z_sieci:
        url = znajdz_playliste(args.esesja)
        if not url:
            raise SystemExit(f"Nie znalazłem transmisji sesji {args.esesja}.")
        dzwiek = DzwiekHls(url)
        # Segmenty idą po czasie, więc kolejne trafiają zwykle w ten sam
        # kawałek — inna kolejność kasowałaby cache i mnożyła pobieranie.
        przedzialy = [(s["start"], s["end"]) for s in segs]
        for s, probki in zip(segs, dzwiek.probki_wielu(przedzialy)):
            policz(s, probki)
        print(f"  pobrane z sieci: {dzwiek.pobranych_bajtow/1e6:.0f} MB", flush=True)
    else:
        blok_start = 0.0
        while blok_start < koniec_sesji:
            w_bloku = [s for s in segs if blok_start <= s["start"] < blok_start + BLOK]
            if w_bloku:
                dlugosc = min(BLOK + MARGINES, koniec_sesji - blok_start + MARGINES)
                audio = dekoduj(args.audio, blok_start, dlugosc)
                for s in w_bloku:
                    i0 = int((s["start"] - blok_start) * SAMPLE_RATE)
                    i1 = int((s["end"] - blok_start) * SAMPLE_RATE)
                    policz(s, audio[i0:i1].astype(np.float32))
            blok_start += BLOK

    ids = sorted(set().union(*[set(w.keys()) for w in wyniki.values()]))
    zapis = {"ids": np.array(ids, dtype=object)}
    for n in nazwy:
        zapis[f"emb_{n}"] = np.stack([wyniki[n][i] for i in ids if i in wyniki[n]])
        zapis[f"ids_{n}"] = np.array([i for i in ids if i in wyniki[n]], dtype=object)
        if args.polowki and polowki[n]:
            zapis[f"pol_{n}"] = np.stack([polowki[n][i] for i in ids if i in polowki[n]])
            zapis[f"polids_{n}"] = np.array([i for i in ids if i in polowki[n]], dtype=object)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **zapis)
    czas = time.time() - start_czas
    print(f"Zapisano {len(ids)} embeddingów do {args.out} "
          f"({czas:.0f} s, {zrobione/max(czas,1):.1f} segm/s)")


if __name__ == "__main__":
    main()
