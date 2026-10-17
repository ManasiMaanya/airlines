import type { BBox } from "./types";

const EARTH_M = 6_371_000;

export function bboxArea(bbox: BBox): number {
  return Math.abs(bbox.lamax - bbox.lamin) * Math.abs(bbox.lomax - bbox.lomin);
}

/** OpenSky `/states/all` credit cost from bounding-box area in square degrees. */
export function creditsForArea(areaSqDeg: number): number {
  if (areaSqDeg <= 25) return 1;
  if (areaSqDeg <= 100) return 2;
  if (areaSqDeg <= 400) return 3;
  return 4;
}

export function validBBox(bbox: BBox): string | null {
  const nums = [bbox.lamin, bbox.lomin, bbox.lamax, bbox.lomax];
  if (nums.some((n) => !Number.isFinite(n))) return "Enter numeric bounds.";
  if (bbox.lamin < -90 || bbox.lamax > 90 || bbox.lamin >= bbox.lamax) {
    return "Latitude must run from south to north, inside -90 to 90.";
  }
  if (bbox.lomin < -180 || bbox.lomax > 180 || bbox.lomin >= bbox.lomax) {
    return "Longitude must run from west to east and stay on one side of the antimeridian.";
  }
  const area = bboxArea(bbox);
  if (area < 0.01) return "That region is too small to query.";
  if (area > 400) return "Regions larger than 400 sq° are blocked to protect the credit budget.";
  return null;
}

export function roundBBox(bbox: BBox, digits = 2): BBox {
  const f = (n: number) => Number(n.toFixed(digits));
  return { lamin: f(bbox.lamin), lomin: f(bbox.lomin), lamax: f(bbox.lamax), lomax: f(bbox.lomax) };
}

export function cacheKey(bbox: BBox): string {
  const b = roundBBox(bbox, 2);
  return `${b.lamin},${b.lomin},${b.lamax},${b.lomax}`;
}

export function sameBBox(a: BBox, b: BBox): boolean {
  return cacheKey(a) === cacheKey(b);
}

export function contains(bbox: BBox, lat: number, lon: number): boolean {
  return lat >= bbox.lamin && lat <= bbox.lamax && lon >= bbox.lomin && lon <= bbox.lomax;
}

/** Share of `inner` covered by the overlap. Used to decide if recorded data is relevant. */
export function overlapRatio(target: BBox, recorded: BBox): number {
  const lat = Math.min(target.lamax, recorded.lamax) - Math.max(target.lamin, recorded.lamin);
  const lon = Math.min(target.lomax, recorded.lomax) - Math.max(target.lomin, recorded.lomin);
  if (lat <= 0 || lon <= 0) return 0;
  const area = bboxArea(target);
  if (area <= 0) return 0;
  return (lat * lon) / area;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Destination point given a true track in degrees and a distance in meters. */
export function project(lat: number, lon: number, trackDeg: number, distanceM: number): { lat: number; lon: number } {
  const delta = distanceM / EARTH_M;
  const theta = (trackDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return {
    lat: (phi2 * 180) / Math.PI,
    lon: ((((lambda2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpNullable(a: number | null, b: number | null, t: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return lerp(a, b, t);
}

export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function pathLength(points: { lat: number; lon: number; gap: boolean }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].gap) continue;
    total += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}
