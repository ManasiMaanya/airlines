import { MAX_EXTRAP_S } from "./constants";
import { project } from "./geo";
import type { Aircraft } from "./types";

export type Prediction = {
  lat: number;
  lon: number;
  alt: number | null;
  extrapolated: boolean;
  frozen: boolean;
  dt: number;
};

type Motion = Pick<
  Aircraft,
  "latitude" | "longitude" | "baroAltitude" | "velocity" | "trueTrack" | "verticalRate" | "onGround" | "timePosition"
>;

/**
 * Project a position forward from the last report using ground speed, true track,
 * and vertical rate. Parked aircraft are left where they were reported.
 */
export function predict(aircraft: Motion, nowMs: number): Prediction | null {
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  const reported: Prediction = {
    lat: aircraft.latitude,
    lon: aircraft.longitude,
    alt: aircraft.baroAltitude,
    extrapolated: false,
    frozen: false,
    dt: 0,
  };
  if (aircraft.timePosition == null || aircraft.trueTrack == null || aircraft.velocity == null) return reported;
  if (aircraft.onGround && aircraft.velocity < 8) return reported;
  if (aircraft.velocity < 1) return reported;

  const dt = nowMs / 1000 - aircraft.timePosition;
  if (dt < 2) return reported;

  const used = Math.min(Math.max(dt, 0), MAX_EXTRAP_S);
  const next = project(aircraft.latitude, aircraft.longitude, aircraft.trueTrack, aircraft.velocity * used);
  const alt =
    aircraft.baroAltitude == null || aircraft.verticalRate == null
      ? aircraft.baroAltitude
      : Math.max(0, aircraft.baroAltitude + aircraft.verticalRate * used);

  return {
    lat: next.lat,
    lon: next.lon,
    alt,
    extrapolated: true,
    frozen: dt > MAX_EXTRAP_S,
    dt,
  };
}
