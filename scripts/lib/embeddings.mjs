// Lokalne embeddingi tekstu (multilingual-e5-small, ONNX, przez @huggingface/transformers).
// Zero kosztu, zero konta u zewnętrznego dostawcy — model pobiera się raz
// (~470 MB, do cache w ~/.cache/huggingface) i dalej liczy offline na CPU.
// Sprawdzone jako właściwa skala: to nie jest sytuacja z [[project_bielik_backlog]]
// (11B model generatywny) — jeden przelot w przód przez mały model embeddingowy,
// więc setki krótkich tekstów liczą się w sekundy, nie w minuty.
//
// Model E5 wymaga prefiksu "query: " / "passage: " przed tekstem — to konwencja
// treningowa, nie kosmetyka: bez niej jakość podobieństwa wyraźnie spada.
// "passage" = tekst, który ma zostać znaleziony (sprawa, blok wypowiedzi);
// "query" = tekst, którym szukamy.

import { pipeline } from "@huggingface/transformers";

let extractorPromise;
function getExtractor() {
  if (!extractorPromise) {
    // dtype: "q8" = wersja skwantyzowana (~90 MB zamiast ~470 MB fp32) — do
    // PoC jakość int8 wystarcza, a pobiera się znacznie szybciej.
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/multilingual-e5-small",
      { dtype: "q8" }
    );
  }
  return extractorPromise;
}

async function embedOne(text, prefix) {
  const extractor = await getExtractor();
  const output = await extractor(`${prefix}: ${text}`, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data);
}

export function embedPassage(text) {
  return embedOne(text, "passage");
}

export function embedQuery(text) {
  return embedOne(text, "query");
}

/** Wektory z normalize:true mają długość 1, więc iloczyn skalarny = cosinus kąta. */
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
