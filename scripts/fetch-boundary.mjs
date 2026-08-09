#!/usr/bin/env node
// Pobiera granicę jednostki administracyjnej z OSM (przez Nominatim), upraszcza
// ją i zapisuje jako statyczny asset dla mapy na stronie głównej.
//
// Uruchamiane RĘCZNIE, raz na jednostkę — nie w czasie działania aplikacji.
// Nominatim ma limity ruchu, a granice powiatu zmieniają się raz na dekadę,
// więc wynik trafia do src/lib/granice/ i tam zostaje.
//
// Zapis do src/, a nie public/: mapa importuje granice statycznie, żeby kształt
// był w pierwszym renderze. Z public/ trzeba by go dociągać fetchem po
// zamontowaniu komponentu, co daje widoczny przeskok. 3,5 kB na jednostkę
// w bundlu jest tańsze niż osobne żądanie i stan ładowania.
//
// Surowa granica powiatu grójeckiego to ~4100 wierzchołków. Na mapie Polski
// powiat zajmuje ok. 8% szerokości (przy 600 px to ~50 px), więc ta precyzja
// jest niewidoczna — upraszczamy Douglasem-Peuckerem do ~1-2% punktów.
//
// Użycie:
//   node scripts/fetch-boundary.mjs "powiat grójecki" powiat-grojecki
//   node scripts/fetch-boundary.mjs "powiat grójecki" powiat-grojecki --tolerance 0.002

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const UA = "rada-mvp/1.0 (https://ktomowi.pl)";
const OUT_DIR = "src/lib/granice";

function log(m) {
  console.log(`[granice] ${m}`);
}

// Odległość punktu od odcinka, w stopniach. Świadomie bez korekty na
// zbieżność południków: przy rozciągłości powiatu (~0,9 stopnia) i celu
// wizualnym błąd jest mniejszy niż piksel, a mapa i tak rzutuje liniowo
// (src/lib/poland-map.ts).
function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const cl = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + cl * dx), py - (ay + cl * dy));
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, idx + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(idx), tolerance),
  ];
}

// Nominatim zwraca Polygon albo MultiPolygon; bierzemy największy pierścień
// zewnętrzny (enklawy i dziury pomijamy — na tej skali nie są widoczne).
function largestOuterRing(geojson) {
  const { type, coordinates } = geojson;
  if (type === "Polygon") return coordinates[0];
  if (type === "MultiPolygon") {
    return coordinates
      .map((poly) => poly[0])
      .reduce((a, b) => (b.length > a.length ? b : a));
  }
  throw new Error(`nieobsługiwany typ geometrii: ${type}`);
}

async function main() {
  const [query, slug, ...rest] = process.argv.slice(2);
  if (!query || !slug) {
    console.error(
      'Użycie: node scripts/fetch-boundary.mjs "<zapytanie>" <slug> [--tolerance N]'
    );
    process.exit(1);
  }
  const tIdx = rest.indexOf("--tolerance");
  const tolerance = tIdx >= 0 ? Number(rest[tIdx + 1]) : 0.0015;

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q: query,
      format: "json",
      polygon_geojson: "1",
      limit: "1",
      countrycodes: "pl",
    });

  log(`pytam Nominatim o "${query}"...`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`brak wyników dla "${query}"`);
  if (hit.class !== "boundary") {
    throw new Error(
      `znaleziony obiekt nie jest granicą (${hit.class}/${hit.type}) — uściślij zapytanie`
    );
  }

  const ring = largestOuterRing(hit.geojson);
  const simplified = simplify(ring, tolerance);

  // GeoJSON jest [lng, lat]; zapisujemy [lat, lng], bo tego oczekuje
  // latLngToPercent() z src/lib/poland-map.ts.
  const latLng = simplified.map(([lng, lat]) => [
    Number(lat.toFixed(5)),
    Number(lng.toFixed(5)),
  ]);

  const payload = {
    slug,
    name: hit.display_name.split(",")[0],
    osm: `${hit.osm_type}/${hit.osm_id}`,
    source: "OpenStreetMap (ODbL)",
    tolerance,
    ring: latLng,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${slug}.json`);
  writeFileSync(out, JSON.stringify(payload));

  const pct = ((simplified.length / ring.length) * 100).toFixed(1);
  log(`${hit.display_name.split(",")[0]} (${payload.osm})`);
  log(`wierzchołki: ${ring.length} → ${simplified.length} (${pct}%)`);
  log(`zapisano ${out} (${JSON.stringify(payload).length} B)`);
}

main().catch((e) => {
  console.error(`[granice] BŁĄD: ${e.message}`);
  process.exit(1);
});
