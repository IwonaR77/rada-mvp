#!/usr/bin/env python3
"""
Zapisuje fragment nagrania sesji do pliku mp3, pobierając tylko potrzebne
kawałki transmisji.

ffmpeg z `-ss` na playliście HLS ściąga strumień sekwencyjnie, jednym
połączeniem — 17 minut końcówki schodziło ponad kwadrans. Ten sam mechanizm,
którego używa rozpoznawanie głosem (hls.py), bierze kawałki równolegle.

Użycie:
  python scripts/voice/wytnij-fragment.py --esesja 74061 --od 7061 --out plik.mp3
"""

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hls import DzwiekHls, znajdz_playliste, SAMPLE_RATE  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument("--esesja", required=True)
p.add_argument("--od", type=float, required=True)
p.add_argument("--do", type=float, dest="do_", help="domyślnie do końca nagrania")
p.add_argument("--out", required=True)
args = p.parse_args()

d = DzwiekHls(znajdz_playliste(args.esesja))
koniec = args.do_ if args.do_ else d.dlugosc
print(f"Nagranie ma {d.dlugosc/3600:.2f} h; wycinam {args.od:.0f}–{koniec:.0f} s "
      f"({(koniec-args.od)/60:.1f} min)", flush=True)

# Krótkie odcinki i `probki_wielu`, nie `probki`: ta druga bierze kawałki
# jeden po drugim, jednym połączeniem (~50 KB/s), a serwer dławi pojedyncze
# połączenie. Z pobieraniem z wyprzedzeniem schodzi to czterokrotnie szybciej.
KROK = 10.0
przedzialy = []
t = args.od
while t < koniec:
    przedzialy.append((t, min(t + KROK, koniec)))
    t += KROK

czesci = []
for nr, probki in enumerate(d.probki_wielu(przedzialy), 1):
    if probki is not None:
        czesci.append(probki.astype(np.int16))
    if nr % 12 == 0:
        print(f"  {nr*KROK:.0f}/{koniec-args.od:.0f} s, pobrane {d.pobranych_bajtow/1e6:.0f} MB", flush=True)

audio = np.concatenate(czesci)
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SAMPLE_RATE),
     "-ac", "1", "-i", "pipe:0", "-q:a", "4", args.out],
    input=audio.tobytes(), check=True,
)
print(f"Zapisano {args.out} ({len(audio)/SAMPLE_RATE/60:.1f} min)")
