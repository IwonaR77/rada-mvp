#!/usr/bin/env bash
# Renderuje docs/architektura/architektura.puml (diagram ArchiMate) do SVG, PNG i PDF.
# Wymaga Javy; PlantUML .jar jest pobierany raz do cache'u poza repo (system
# ma tylko starą wersję 1.2020.02, niekompatybilną z biblioteką Archimate).
# PDF nie idzie przez natywny eksport PlantUML (-tpdf gubi polskie znaki
# diakrytyczne bez względu na skinparam fontu) — zamiast tego SVG jest
# drukowane do PDF przez headless Chrome, który renderuje Unicode poprawnie.
# Uruchom: bash scripts/render-architecture.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGRAM_DIR="$REPO_ROOT/docs/architektura"
CACHE_DIR="$HOME/.cache/rada-mvp-tools"
JAR="$CACHE_DIR/plantuml.jar"
PLANTUML_VERSION="v1.2026.6"
JAR_URL="https://github.com/plantuml/plantuml/releases/download/${PLANTUML_VERSION}/plantuml.jar"
EXPECTED_MIN_SIZE=25000000 # ~29MB pełny plik; dociąga poniżej tego progu

mkdir -p "$CACHE_DIR"

current_size() { stat -c%s "$JAR" 2>/dev/null || echo 0; }

if [ ! -f "$JAR" ] || [ "$(current_size)" -lt "$EXPECTED_MIN_SIZE" ]; then
  echo "Pobieram PlantUML $PLANTUML_VERSION do $JAR (sieć w tym środowisku bywa niestabilna przy dużych plikach, więc próbuję wznawiać)..."
  for _ in $(seq 1 15); do
    [ "$(current_size)" -ge "$EXPECTED_MIN_SIZE" ] && break
    curl -sL --max-time 100 -C - "$JAR_URL" -o "$JAR"
  done
  if [ "$(current_size)" -lt "$EXPECTED_MIN_SIZE" ]; then
    echo "Pobieranie PlantUML nie powiodło się (plik za mały: $(current_size) B)." >&2
    exit 1
  fi
fi

cd "$DIAGRAM_DIR"
java -jar "$JAR" -tsvg architektura.puml
java -jar "$JAR" -tpng architektura.puml
mv "Architektura Rada (Agatka).svg" architektura.svg
mv "Architektura Rada (Agatka).png" architektura.png

CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
if [ -n "$CHROME_BIN" ]; then
  WIDTH_PX="$(grep -o 'viewBox="[0-9 .]*"' architektura.svg | head -1 | grep -oE '[0-9.]+' | sed -n '3p')"
  HEIGHT_PX="$(grep -o 'viewBox="[0-9 .]*"' architektura.svg | head -1 | grep -oE '[0-9.]+' | sed -n '4p')"
  WIDTH_IN="$(python3 -c "print(f'{$WIDTH_PX/96:.3f}')")"
  HEIGHT_IN="$(python3 -c "print(f'{$HEIGHT_PX/96:.3f}')")"
  cat > _svg2pdf_tmp.html << HTML
<!doctype html><html><head><meta charset="utf-8">
<style>
@page { size: ${WIDTH_IN}in ${HEIGHT_IN}in; margin: 0; }
html,body { margin:0; padding:0; }
img { display:block; width:${WIDTH_PX}px; height:${HEIGHT_PX}px; }
</style></head>
<body><img src="architektura.svg"></body></html>
HTML
  "$CHROME_BIN" --headless --disable-gpu --no-sandbox --print-to-pdf=architektura.pdf \
    --no-pdf-header-footer "file://$DIAGRAM_DIR/_svg2pdf_tmp.html" 2>/dev/null
  rm -f _svg2pdf_tmp.html
  echo "Gotowe: $DIAGRAM_DIR/architektura.svg, architektura.png, architektura.pdf"
else
  echo "Gotowe: $DIAGRAM_DIR/architektura.svg, architektura.png"
  echo "Uwaga: nie znaleziono Chrome/Chromium, pominięto generowanie PDF." >&2
fi
