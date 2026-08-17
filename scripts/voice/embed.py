#!/usr/bin/env python3
"""
Embeddingi głosu przez ONNX Runtime — bez torcha i bez GPU.

Dlaczego nie speechbrain/pyannote jak w scripts/transcribe_and_identify.py:
torch + torchaudio to ~3 GB na dysku, a na tej maszynie zostało ~2 GB i nie ma
karty. Modele WeSpeaker mają gotowe pliki .onnx (~25 MB), więc liczą to samo
w onnxruntime na CPU.

Dwa modele, nie jeden: `resnet34` (voxceleb_resnet34_LM) i `campplus`
(voxceleb_CAM++_LM). Różne architektury, więc mylą się w różnych miejscach —
przy wymogu zgody obu pomyłka musi zdarzyć się dwa razy naraz. To główne
zabezpieczenie przed błędną identyfikacją, która w tym projekcie jest dużo
gorsza niż brak identyfikacji.

Cechy wejściowe muszą być takie, jak przy trenowaniu WeSpeakera: fbank Kaldi,
80 pasm mel, okno 25 ms / krok 10 ms, bez ditheru, i odjęta średnia po czasie
(CMN). Stąd kaldi-native-fbank zamiast liczenia mel-ów samodzielnie w numpy —
rozjazd w cechach cicho psuje jakość embeddingów, bez żadnego błędu.
"""

import subprocess
import numpy as np
import kaldi_native_fbank as knf
import onnxruntime as ort

SAMPLE_RATE = 16000


def wczytaj_audio(sciezka, start=None, koniec=None):
    """Dekoduje (fragment) pliku audio do float32 mono 16 kHz przez ffmpeg."""
    cmd = ["ffmpeg", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(sciezka)]
    if koniec is not None and start is not None:
        cmd += ["-t", f"{max(0.0, koniec - start):.3f}"]
    cmd += ["-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"]
    surowe = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(surowe, dtype=np.int16).astype(np.float32)


def fbank(probki):
    """Cechy fbank zgodne z Kaldi, tak jak w treningu WeSpeakera."""
    opts = knf.FbankOptions()
    opts.frame_opts.samp_freq = SAMPLE_RATE
    opts.frame_opts.dither = 0.0
    opts.frame_opts.snip_edges = True
    opts.mel_opts.num_bins = 80
    f = knf.OnlineFbank(opts)
    f.accept_waveform(SAMPLE_RATE, probki.tolist())
    f.input_finished()
    ramki = [f.get_frame(i) for i in range(f.num_frames_ready)]
    if not ramki:
        return None
    cechy = np.asarray(ramki, dtype=np.float32)
    return cechy - cechy.mean(axis=0, keepdims=True)  # CMN


class Model:
    def __init__(self, sciezka):
        opts = ort.SessionOptions()
        # Jeden wątek na sesję: i tak puszczamy wiele segmentów, a domyślne
        # rozrzucanie na wszystkie rdzenie tylko bije się z ffmpegiem obok.
        opts.intra_op_num_threads = 2
        opts.inter_op_num_threads = 1
        self.sesja = ort.InferenceSession(str(sciezka), sess_options=opts,
                                          providers=["CPUExecutionProvider"])
        self.wejscie = self.sesja.get_inputs()[0].name
        self.wyjscie = self.sesja.get_outputs()[0].name

    def embedding(self, probki):
        """Znormalizowany embedding (L2) albo None, gdy materiał za krótki."""
        if probki is None or len(probki) < SAMPLE_RATE * 0.5:
            return None
        cechy = fbank(probki)
        if cechy is None or cechy.shape[0] < 50:
            return None
        wynik = self.sesja.run([self.wyjscie], {self.wejscie: cechy[None, :, :]})[0][0]
        norma = np.linalg.norm(wynik)
        return None if norma == 0 else (wynik / norma).astype(np.float32)


def podobienstwo(a, b):
    """Kosinus dla wektorów już znormalizowanych."""
    return float(np.dot(a, b))


if __name__ == "__main__":
    import sys

    # Sprawdzian: policz embedding fragmentu i wypisz jego wymiar.
    model = Model(sys.argv[1])
    probki = wczytaj_audio(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]))
    e = model.embedding(probki)
    print("brak embeddingu" if e is None else f"wymiar={e.shape[0]} norma={np.linalg.norm(e):.3f}")
