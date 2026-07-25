// Projection bounds match the NordNordWest Poland location map series
// (Wikimedia Commons), so lat/lng can be placed with simple linear
// interpolation against public/poland.svg's viewBox.
const BOUNDS = { top: 55.2, bottom: 48.7, left: 13.8, right: 24.5 };

export function latLngToPercent(lat: number, lng: number) {
  const x = ((lng - BOUNDS.left) / (BOUNDS.right - BOUNDS.left)) * 100;
  const y = ((BOUNDS.top - lat) / (BOUNDS.top - BOUNDS.bottom)) * 100;
  return { x, y };
}
