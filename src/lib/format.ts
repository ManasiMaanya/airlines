import { EMERGENCY_SQUAWKS, POSITION_SOURCES } from "./constants";
import type { Units } from "./types";

const KT = 1.943844;
const FT = 3.28084;
const FPM = 196.8504;

export function isEmergencySquawk(squawk: string | null): boolean {
  return squawk != null && EMERGENCY_SQUAWKS.has(squawk);
}

export function emergencyLabel(squawk: string): string {
  if (squawk === "7500") return "7500 unlawful interference";
  if (squawk === "7600") return "7600 radio failure";
  if (squawk === "7700") return "7700 general emergency";
  return squawk;
}

export function toFeet(meters: number): number {
  return meters * FT;
}

export function toMeters(feet: number): number {
  return feet / FT;
}

export function toKnots(mps: number): number {
  return mps * KT;
}

export function toMps(knots: number): number {
  return knots / KT;
}

export function formatAlt(meters: number | null, units: Units, onGround = false): string {
  if (onGround && (meters == null || meters < 50)) return "GND";
  if (meters == null) return "—";
  if (units === "si") return `${Math.round(meters).toLocaleString("en-US")} m`;
  return `${Math.round(toFeet(meters)).toLocaleString("en-US")} ft`;
}

export function formatFlightLevel(meters: number | null): string | null {
  if (meters == null || meters < 1000) return null;
  return `FL${Math.round(toFeet(meters) / 100)}`;
}

export function formatSpeed(mps: number | null, units: Units): string {
  if (mps == null) return "—";
  if (units === "si") return `${Math.round(mps)} m/s`;
  return `${Math.round(toKnots(mps))} kt`;
}

export function formatVertical(mps: number | null, units: Units): string {
  if (mps == null) return "—";
  if (Math.abs(mps) < 0.4) return "level";
  const arrow = mps > 0 ? "↑" : "↓";
  if (units === "si") return `${arrow} ${Math.abs(mps).toFixed(1)} m/s`;
  return `${arrow} ${Math.round(Math.abs(mps) * FPM).toLocaleString("en-US")} ft/min`;
}

export function formatTrack(deg: number | null): string {
  if (deg == null) return "—";
  return `${Math.round(deg).toString().padStart(3, "0")}°`;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`;
}

export function positionSourceLabel(source: number): string {
  return POSITION_SOURCES[source] ?? `source ${source}`;
}

export function callsignOrIcao(callsign: string | null, icao24: string): string {
  return callsign && callsign.length > 0 ? callsign : icao24.toUpperCase();
}

export function budgetMinutes(creditsRemaining: number | null, creditCost: number, refreshMs: number): number | null {
  if (creditsRemaining == null || creditCost <= 0) return null;
  const requests = Math.floor(creditsRemaining / creditCost);
  return Math.round((requests * refreshMs) / 60_000);
}
