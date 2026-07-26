"""
transcribe_and_identify.py

Transkrypcja nagrania sesji rady (mp3/wav) z rozpoznawaniem mówcy na podstawie
ZAMKNIĘTEGO rejestru głosów (radni + urzędnicy) — zamiast pełnej diaryzacji
z klastrowaniem (pyannote pipeline), która przy nagraniach 2-3h i >20 mówcach
zużywa dużo RAM i się wywala (złożoność O(n^2) klastrowania).

Dlaczego inaczej niż klasyczna diaryzacja:
- Diaryzacja odkrywa "ile w ogóle jest tu głosów" od zera -> kosztowne globalne
  klastrowanie całego pliku naraz.
- Ty znasz tożsamość radnych/urzędników z góry (zamknięty zbiór ~20-30 osób),
  więc zamiast klastrowania robimy rozpoznawanie 1:N (speaker verification)
  NIEZALEŻNIE dla każdego segmentu -> złożoność liniowa względem liczby
  segmentów, zero globalnego klastrowania, zero crasha przy długich plikach.
- Mówcy spoza rejestru (mieszkańcy, przypadkowi goście) trafiają do kubełka
  "nieznany" zamiast być błędnie dopasowani do najbliższego radnego.

Pipeline:
  1. Transkrypcja z sygnaturami czasu -> faster-whisper (ma wbudowany VAD,
     więc nie potrzeba osobnego wykrywania mowy — stabilne na długich plikach).
  2. Dla każdego segmentu transkrypcji: wytnij odpowiadający fragment audio
     (z jednorazowo wczytanego, znormalizowanego przebiegu — nie z dysku za
     każdym razem) i policz embedding głosu (SpeechBrain ECAPA-TDNN — model do
     ROZPOZNAWANIA mówcy, nie do diaryzacji).
  3. Porównaj embedding z zarejestrowanymi wzorcami głosów (enrollment).
     Jeśli podobieństwo kosinusowe przekracza próg -> przypisz osobę + rolę.
     Jeśli nie -> "nieznany" (mieszkaniec / gość / niezarejestrowany).
  4. Zapisz wynik jako JSON gotowy do wgrania do tabeli `segment` w Supabase.

Rejestr głosów (enrollment) buduje się OSOBNO, z folderu nagranych próbek —
patrz tryb `enroll` w CLI na dole pliku.

Wymagania (requirements.txt):
    faster-whisper
    speechbrain
    torch
    torchaudio
    numpy

Wymaga też zainstalowanego ffmpeg w systemie (konwersja audio do 16kHz mono).

Użycie:
    # 1) zbuduj rejestr głosów z folderu próbek (raz, na start)
    python transcribe_and_identify.py enroll ./probki_glosow --output voiceprints.json

    # 2) transkrybuj i rozpoznaj mówców w nagraniu sesji
    python transcribe_and_identify.py run sesja_2026_07_15.mp3 \
        --voiceprints voiceprints.json --output sesja_2026_07_15.json

Struktura folderu próbek dla trybu `enroll`:
    probki_glosow/
      radny_jan_kowalski/
        role.txt          <- zawiera np. "radny" (albo "urzednik")
        probka1.wav
        probka2.wav
      urzednik_anna_nowak/
        role.txt          <- "urzednik"
        probka1.wav

To jest szkielet referencyjny — próg SIMILARITY_THRESHOLD trzeba skalibrować
na Twoich realnych nagraniach (patrz komentarz przy stałej niżej).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# Konfiguracja
# ---------------------------------------------------------------------------

WHISPER_MODEL_SIZE = "large-v3"   # "medium" jeśli mało VRAM / brak GPU (wolniej, ale działa na CPU)
WHISPER_LANGUAGE = "pl"
SAMPLE_RATE = 16000

# Próg podobieństwa kosinusowego, powyżej którego uznajemy dopasowanie za pewne.
# 0.75 to bezpieczny punkt startowy dla ECAPA-TDNN — skalibruj na własnych danych:
# policz similarity dla par (ten sam mówca) i (różni mówcy) na kilku sesjach
# i wybierz próg, który je najlepiej rozdziela.
SIMILARITY_THRESHOLD = 0.75

VOICEPRINTS_PATH = Path("voiceprints.json")


# ---------------------------------------------------------------------------
# Struktury danych
# ---------------------------------------------------------------------------

@dataclass
class SpeakerMatch:
    person_id: Optional[str]
    name: Optional[str]
    role: str  # "radny" | "urzednik" | "nieznany"
    confidence: float


@dataclass
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str
    speaker: SpeakerMatch


# ---------------------------------------------------------------------------
# Audio: konwersja do jednolitego formatu 16kHz mono (raz, przez ffmpeg)
# ---------------------------------------------------------------------------

def ensure_wav16k(audio_path: Path) -> Path:
    """Konwertuje dowolny plik audio (mp3, m4a...) do 16kHz mono WAV przez ffmpeg.
    Wynik cache'owany obok oryginału, żeby nie konwertować dwa razy."""
    tmp_wav = audio_path.with_suffix(".16k.wav")
    if tmp_wav.exists():
        return tmp_wav

    print(f"Konwersja {audio_path.name} -> 16kHz mono WAV...", file=sys.stderr)
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            str(tmp_wav),
        ],
        check=True,
        capture_output=True,
    )
    return tmp_wav


def load_waveform(wav_path: Path):
    """Wczytuje CAŁY plik RAZ do pamięci jako tensor — segmenty tniemy potem
    z tego tensora (indeksowanie), zamiast czytać plik z dysku dla każdego
    segmentu z osobna. Przy nagraniu 2-3h i setkach segmentów to jest
    różnica między minutami a godzinami przetwarzania."""
    import torchaudio

    signal, sr = torchaudio.load(str(wav_path))
    assert sr == SAMPLE_RATE, f"Oczekiwano {SAMPLE_RATE}Hz, plik ma {sr}Hz — sprawdź ensure_wav16k()"
    return signal, sr


# ---------------------------------------------------------------------------
# Krok 1: Transkrypcja (faster-whisper)
# ---------------------------------------------------------------------------

def transcribe(audio_path: Path):
    """Zwraca listę (start_s, end_s, text). faster-whisper ma wbudowany VAD,
    więc pomija ciszę i długie przerwy bez osobnego preprocessing — stabilne
    również na nagraniach wielogodzinnych."""
    from faster_whisper import WhisperModel

    print(f"[1/3] Ładowanie modelu Whisper ({WHISPER_MODEL_SIZE})...", file=sys.stderr)
    model = WhisperModel(WHISPER_MODEL_SIZE, device="auto", compute_type="auto")

    print(f"[1/3] Transkrypcja {audio_path.name}...", file=sys.stderr)
    segments, info = model.transcribe(
        str(audio_path),
        language=WHISPER_LANGUAGE,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    result = [(seg.start, seg.end, seg.text.strip()) for seg in segments]
    print(f"[1/3] Gotowe: {len(result)} segmentów (wykryty język: {info.language})", file=sys.stderr)
    return result


# ---------------------------------------------------------------------------
# Krok 2: Embedding głosu (SpeechBrain ECAPA-TDNN — rozpoznawanie, nie diaryzacja)
# ---------------------------------------------------------------------------

class SpeakerEmbedder:
    def __init__(self):
        from speechbrain.inference.speaker import EncoderClassifier

        print("[2/3] Ładowanie modelu embeddingów głosu (ECAPA-TDNN)...", file=sys.stderr)
        self.model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
        )

    def embed_file(self, wav_path: Path) -> np.ndarray:
        """Embedding całego krótkiego pliku — używane przy enrollmencie."""
        signal, _ = load_waveform(wav_path)
        embedding = self.model.encode_batch(signal)
        return embedding.squeeze().detach().cpu().numpy()

    def embed_slice(self, waveform, sr: int, start_s: float, end_s: float) -> Optional[np.ndarray]:
        """Embedding fragmentu [start_s, end_s] wyciętego z już wczytanego
        tensora. Zwraca None dla zbyt krótkich fragmentów (<0.5s — niewiarygodny
        embedding głosu)."""
        if end_s - start_s < 0.5:
            return None

        start_frame = int(start_s * sr)
        end_frame = int(end_s * sr)
        clip = waveform[:, start_frame:end_frame]
        if clip.shape[1] == 0:
            return None

        embedding = self.model.encode_batch(clip)
        return embedding.squeeze().detach().cpu().numpy()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


# ---------------------------------------------------------------------------
# Krok 3: Rejestr głosów (enrollment) i dopasowanie
# ---------------------------------------------------------------------------

def load_voiceprints(path: Path) -> dict:
    if not path.exists():
        print(
            f"UWAGA: brak pliku {path} — wszystkie segmenty wyjdą jako 'nieznany'. "
            f"Uruchom najpierw tryb 'enroll'.",
            file=sys.stderr,
        )
        return {}

    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    return {
        pid: {
            "name": entry["name"],
            "role": entry["role"],
            "embedding": np.array(entry["embedding"], dtype=np.float32),
        }
        for pid, entry in raw.items()
    }


def match_speaker(embedding: Optional[np.ndarray], voiceprints: dict) -> SpeakerMatch:
    if embedding is None or not voiceprints:
        return SpeakerMatch(person_id=None, name=None, role="nieznany", confidence=0.0)

    best_id, best_score = None, -1.0
    for pid, entry in voiceprints.items():
        score = cosine_similarity(embedding, entry["embedding"])
        if score > best_score:
            best_id, best_score = pid, score

    if best_score >= SIMILARITY_THRESHOLD:
        entry = voiceprints[best_id]
        return SpeakerMatch(person_id=best_id, name=entry["name"], role=entry["role"], confidence=best_score)

    return SpeakerMatch(person_id=None, name=None, role="nieznany", confidence=best_score)


# ---------------------------------------------------------------------------
# Budowanie rejestru głosów z folderu próbek (tryb CLI: enroll)
# ---------------------------------------------------------------------------

def build_voiceprints(samples_dir: Path, output_path: Path) -> None:
    embedder = SpeakerEmbedder()
    voiceprints = {}

    for person_dir in sorted(samples_dir.iterdir()):
        if not person_dir.is_dir():
            continue

        role_file = person_dir / "role.txt"
        role = role_file.read_text(encoding="utf-8").strip() if role_file.exists() else "radny"
        display_name = person_dir.name.replace("_", " ")

        wav_files = sorted(person_dir.glob("*.wav"))
        if not wav_files:
            print(f"  Pomijam {person_dir.name}: brak plików .wav (potnij próbki przez ensure_wav16k)", file=sys.stderr)
            continue

        embeddings = [embedder.embed_file(w) for w in wav_files]
        avg_embedding = np.mean(embeddings, axis=0)

        voiceprints[person_dir.name] = {
            "name": display_name,
            "role": role,
            "embedding": avg_embedding.tolist(),
        }
        print(f"  Zarejestrowano: {display_name} ({role}), {len(wav_files)} próbek", file=sys.stderr)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(voiceprints, f, ensure_ascii=False, indent=2)

    print(f"Zapisano rejestr {len(voiceprints)} osób -> {output_path}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Główny pipeline: transkrypcja + rozpoznawanie mówcy per segment
# ---------------------------------------------------------------------------

def transcribe_and_identify(audio_path: Path, voiceprints_path: Path) -> list[TranscriptSegment]:
    wav_path = ensure_wav16k(audio_path)

    whisper_segments = transcribe(audio_path)  # faster-whisper dekoduje oryginał sam (ffmpeg pod spodem)
    voiceprints = load_voiceprints(voiceprints_path)

    waveform, sr = load_waveform(wav_path)      # wczytane RAZ, do wycinania fragmentów
    embedder = SpeakerEmbedder()

    print(f"[3/3] Rozpoznawanie mówcy dla {len(whisper_segments)} segmentów...", file=sys.stderr)
    results = []
    for start_s, end_s, text in whisper_segments:
        embedding = embedder.embed_slice(waveform, sr, start_s, end_s)
        speaker = match_speaker(embedding, voiceprints)
        results.append(
            TranscriptSegment(
                start_ms=int(start_s * 1000),
                end_ms=int(end_s * 1000),
                text=text,
                speaker=speaker,
            )
        )

    return results


def save_results(segments: list[TranscriptSegment], output_path: Path) -> None:
    payload = [
        {
            "start_ms": seg.start_ms,
            "end_ms": seg.end_ms,
            "text": seg.text,
            "suggested_person_id": seg.speaker.person_id,
            "suggested_name": seg.speaker.name,
            "suggested_role": seg.speaker.role,
            "confidence": round(seg.speaker.confidence, 4),
        }
        for seg in segments
    ]
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Zapisano wynik -> {output_path}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Transkrypcja + rozpoznawanie mówcy (radni/urzędnicy) dla nagrań sesji rady, "
                    "bez pełnej diaryzacji/klastrowania."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_enroll = subparsers.add_parser("enroll", help="Zbuduj rejestr głosów z folderu próbek.")
    p_enroll.add_argument("samples_dir", type=Path, help="Folder z podfolderami osób i plikami .wav")
    p_enroll.add_argument("--output", type=Path, default=VOICEPRINTS_PATH)

    p_run = subparsers.add_parser("run", help="Transkrybuj plik mp3/wav i rozpoznaj mówców.")
    p_run.add_argument("audio_path", type=Path, help="Ścieżka do nagrania sesji (mp3/wav)")
    p_run.add_argument("--voiceprints", type=Path, default=VOICEPRINTS_PATH)
    p_run.add_argument("--output", type=Path, default=Path("transcript.json"))

    args = parser.parse_args()

    if args.command == "enroll":
        build_voiceprints(args.samples_dir, args.output)
    elif args.command == "run":
        segments = transcribe_and_identify(args.audio_path, args.voiceprints)
        save_results(segments, args.output)


if __name__ == "__main__":
    main()
