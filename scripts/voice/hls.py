#!/usr/bin/env python3
"""
Dźwięk z transmisji esesja.tv bez pobierania całej sesji.

Po co: serwer oddaje wyłącznie strumień HLS 480p (~1,9 Mb/s) i ignoruje
`audioOnly`, więc żeby dostać 3,5 h dźwięku, ffmpeg musi ściągnąć ~1,2 GB
obrazu i go wyrzucić — przy 17 sesjach to doba pobierania. A do zbudowania
wzorca głosu potrzeba z sesji kilkunastu krótkich fragmentów, nie całości.

Strumień jest pocięty na ~10-sekundowe kawałki `.ts`, a lista kawałków podaje
czas trwania każdego z nich — czyli da się policzyć, w którym kawałku leży
segment o zadanym czasie, i pobrać tylko ten jeden. Przy budowie wzorców
oszczędza to rząd wielkości danych.

Kawałki trzymamy w pamięci (kilka ostatnich), nie na dysku: sortując segmenty
po czasie trafiamy zwykle w ten sam kawałek kilka razy z rzędu, a po przejściu
dalej nie jest już do niczego potrzebny.
"""

import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np

SAMPLE_RATE = 16000
PODGLAD = 0.3  # sekundy zapasu z sąsiednich kawałków, na zaokrąglenia


def pobierz(url, prob=4):
    # Adresy sesji bywają z polskimi znakami („…w-grójcu.htm") — urllib wymaga
    # ich zakodowania, inaczej wywala się na UnicodeEncodeError. Kodujemy tylko
    # znaki spoza ASCII, żeby nie ruszyć już zakodowanych fragmentów.
    url = urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~")
    # Ponawiamy, bo łącze do stream1.esesja.tv potrafi zamilknąć na chwilę,
    # a przy setkach kawałków na sesję jedno takie zerwanie przewracało cały
    # kilkudziesięciominutowy przebieg (widziane 16.08.2026 na sesji 81281).
    for nr in range(prob):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception:
            if nr == prob - 1:
                raise
            time.sleep(2 ** nr)


def znajdz_playliste(esesja_id):
    """URL playlisty HLS sesji — ze strony transmisji rady, tak jak pipeline."""
    listing = pobierz(
        "https://grojec.esesja.pl/transmisje_z_obrad_rady"
    ).decode("utf-8", "replace")
    link = re.search(rf"/transmisja/{esesja_id}/[^\"']+\.htm", listing)
    if not link:
        return None
    strona = pobierz(f"https://grojec.esesja.pl{link.group(0)}").decode("utf-8", "replace")
    m = re.search(r"videourl='([^']+)'", strona)
    return m.group(1) if m else None


class DzwiekHls:
    """Fragmenty dźwięku transmisji, pobierane kawałkami na żądanie."""

    def __init__(self, playlist_url, pamiec_kawalkow=20, watki=6):
        self.baza = playlist_url.rsplit("/", 1)[0]
        tekst = pobierz(playlist_url).decode("utf-8", "replace")

        # playlist.m3u8 to lista wariantów — bierzemy pierwszy (jest jeden).
        if "#EXT-X-STREAM-INF" in tekst:
            wariant = [l.strip() for l in tekst.splitlines()
                       if l.strip() and not l.startswith("#")][0]
            playlist_url = f"{self.baza}/{wariant}"
            self.baza = playlist_url.rsplit("/", 1)[0]
            tekst = pobierz(playlist_url).decode("utf-8", "replace")

        self.kawalki, self.poczatki = [], []
        czas = 0.0
        trwanie = None
        for linia in tekst.splitlines():
            linia = linia.strip()
            if linia.startswith("#EXTINF:"):
                trwanie = float(linia.split(":", 1)[1].rstrip(",").split(",")[0])
            elif linia and not linia.startswith("#") and trwanie is not None:
                self.kawalki.append(linia)
                self.poczatki.append(czas)
                czas += trwanie
                trwanie = None
        self.dlugosc = czas
        self.poczatki = np.array(self.poczatki)
        self._cache = OrderedDict()
        self._pamiec = pamiec_kawalkow
        self.pobranych_bajtow = 0
        self._zamek = threading.Lock()
        self._w_drodze = {}
        # Serwer dławi POJEDYNCZE połączenie do ~45 KB/s niezależnie od tego,
        # ile ich otworzymy — jedno daje 93 KB/s, pięć równoległych 170 KB/s.
        # Kilka wątków to więc jedyny sposób na sensowne tempo; nie mnożymy ich
        # bez umiaru, bo to mała serwerownia rady, a nie CDN.
        self._watki = ThreadPoolExecutor(max_workers=watki)

    def _sciagnij(self, i):
        dane = pobierz(f"{self.baza}/{self.kawalki[i]}")
        with self._zamek:
            self.pobranych_bajtow += len(dane)
            self._cache[i] = dane
            while len(self._cache) > self._pamiec:
                self._cache.popitem(last=False)
            self._w_drodze.pop(i, None)
        return dane

    def _zamow(self, i):
        """Zleca pobranie kawałka, nie czekając na wynik."""
        if not 0 <= i < len(self.kawalki):
            return None
        with self._zamek:
            if i in self._cache:
                self._cache.move_to_end(i)
                return None
            if i not in self._w_drodze:
                self._w_drodze[i] = self._watki.submit(self._sciagnij, i)
            return self._w_drodze[i]

    def _kawalek(self, i):
        with self._zamek:
            if i in self._cache:
                self._cache.move_to_end(i)
                return self._cache[i]
            zlecenie = self._w_drodze.get(i)
        if zlecenie is not None:
            return zlecenie.result()
        return self._sciagnij(i)

    def _indeksy(self, start, koniec):
        i0 = int(np.searchsorted(self.poczatki, start - PODGLAD, "right") - 1)
        i1 = int(np.searchsorted(self.poczatki, koniec + PODGLAD, "right") - 1)
        return max(0, i0), min(len(self.kawalki) - 1, i1)

    def probki_wielu(self, przedzialy, wyprzedzenie=10):
        """Jak `probki`, ale dla listy (start, koniec) posortowanej po czasie.

        Kolejne kawałki zamawia z wyprzedzeniem, w osobnych wątkach: pobranie
        jednego trwa kilka sekund, policzenie embeddingu ze dwie, a robione po
        kolei czekają na siebie na zmianę — sieć stoi, kiedy liczy procesor,
        i odwrotnie.
        """
        for n, (start, koniec) in enumerate(przedzialy):
            for start_p, koniec_p in przedzialy[n + 1:n + 1 + wyprzedzenie]:
                a, b = self._indeksy(start_p, koniec_p)
                for i in range(a, b + 1):
                    self._zamow(i)
            yield self.probki(start, koniec)

    def probki(self, start, koniec):
        """PCM float32 mono 16 kHz dla [start, koniec) w czasie sesji."""
        if koniec <= start or start < 0 or start >= self.dlugosc:
            return None
        i0, i1 = self._indeksy(start, koniec)

        surowe = b"".join(self._kawalek(i) for i in range(i0, i1 + 1))
        # Dekodujemy sklejone kawałki naraz: MPEG-TS się skleja, a jedno
        # wywołanie ffmpega zamiast kilku to mniej narzutu niż samo dekodowanie.
        proc = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-f", "mpegts", "-i", "pipe:0",
             "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1",
             "-ar", str(SAMPLE_RATE), "-"],
            input=surowe, capture_output=True,
        )
        audio = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32)
        if audio.size == 0:
            return None
        # Czas liczony od początku PIERWSZEGO pobranego kawałka, nie od zera sesji.
        przesuniecie = start - float(self.poczatki[i0])
        a = int(przesuniecie * SAMPLE_RATE)
        b = a + int((koniec - start) * SAMPLE_RATE)
        return audio[max(0, a):b]


if __name__ == "__main__":
    import sys

    # Sprawdzian: ile kawałków ma sesja i czy da się wyciąć z niej fragment.
    url = znajdz_playliste(sys.argv[1])
    print("playlista:", url)
    d = DzwiekHls(url)
    print(f"{len(d.kawalki)} kawałków, {d.dlugosc/3600:.2f} h")
    p = d.probki(float(sys.argv[2]), float(sys.argv[3]))
    print("brak" if p is None else
          f"{len(p)/SAMPLE_RATE:.2f} s dźwięku, pobrane {d.pobranych_bajtow/1e6:.1f} MB")
