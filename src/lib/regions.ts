import type { Region } from "./types";

export const REGIONS: Region[] = [
  { id: "london", name: "London", lamin: 51.2, lomin: -0.55, lamax: 51.75, lomax: 0.25 },
  { id: "southeast", name: "SE England", lamin: 51.0, lomin: -1.2, lamax: 52.0, lomax: 1.0 },
  { id: "paris", name: "Paris", lamin: 48.7, lomin: 2.05, lamax: 49.1, lomax: 2.65 },
  { id: "frankfurt", name: "Frankfurt", lamin: 49.9, lomin: 8.3, lamax: 50.3, lomax: 8.95 },
  { id: "amsterdam", name: "Amsterdam", lamin: 52.15, lomin: 4.5, lamax: 52.55, lomax: 5.1 },
  { id: "nyc", name: "New York", lamin: 40.45, lomin: -74.3, lamax: 40.95, lomax: -73.65 },
  { id: "delhi", name: "Delhi", lamin: 28.35, lomin: 76.85, lamax: 28.9, lomax: 77.45 },
  { id: "dubai", name: "Dubai", lamin: 24.95, lomin: 55.05, lamax: 25.4, lomax: 55.55 },
  { id: "singapore", name: "Singapore", lamin: 1.15, lomin: 103.6, lamax: 1.5, lomax: 104.1 },
  { id: "tokyo", name: "Tokyo", lamin: 35.4, lomin: 139.45, lamax: 35.9, lomax: 140.05 },
];

export const DEFAULT_REGION = REGIONS[0];
