import { DEPART_AFTER_MS, DROP_AFTER_MS, MAX_OBSERVATIONS, OUTDATED_AFTER_S } from "./constants";
import { haversine } from "./geo";
import type { Aircraft, Observation, Report, TrackEvent, TrackStatus } from "./types";

const JUMP_M = 80_000;

function labelOf(report: { callsign: string | null; icao24: string }): string {
  return report.callsign ?? report.icao24.toUpperCase();
}

function event(kind: TrackEvent["kind"], report: { callsign: string | null; icao24: string }, t: number, message: string): TrackEvent {
  return {
    id: `${kind}-${report.icao24}-${t}`,
    t,
    kind,
    icao24: report.icao24,
    callsign: report.callsign,
    message,
  };
}

export function appendObservation(list: Observation[], point: Observation): Observation[] {
  const previous = list[list.length - 1];
  let nextPoint = point;
  if (previous) {
    const moved = haversine(previous.lat, previous.lon, point.lat, point.lon);
    if (moved > JUMP_M) {
      nextPoint = { ...point, gap: true };
    } else if (point.t - previous.t < 8 && moved < 80) {
      return list;
    }
  }
  const next = [...list, nextPoint];
  if (next.length > MAX_OBSERVATIONS) next.splice(0, next.length - MAX_OBSERVATIONS);
  return next;
}

function staleAtIngest(report: Report, stampMs: number): boolean {
  if (report.timePosition == null) return true;
  return stampMs / 1000 - report.timePosition > OUTDATED_AFTER_S;
}

function reportFields(report: Report): Report {
  return {
    icao24: report.icao24,
    callsign: report.callsign,
    originCountry: report.originCountry,
    timePosition: report.timePosition,
    lastContact: report.lastContact,
    longitude: report.longitude,
    latitude: report.latitude,
    baroAltitude: report.baroAltitude,
    onGround: report.onGround,
    velocity: report.velocity,
    trueTrack: report.trueTrack,
    verticalRate: report.verticalRate,
    geoAltitude: report.geoAltitude,
    squawk: report.squawk,
    spi: report.spi,
    positionSource: report.positionSource,
  };
}

/**
 * Fold a new snapshot into the tracked set.
 * Aircraft missing from a newer snapshot coast, then depart.
 * A report with no coordinates keeps the previous fix instead of erasing it.
 */
export function mergeTracks(
  prev: Record<string, Aircraft>,
  reports: Report[],
  nowMs: number,
  upstreamSec: number | null,
): { aircraft: Record<string, Aircraft>; events: TrackEvent[] } {
  const events: TrackEvent[] = [];
  const stamp = upstreamSec != null ? upstreamSec * 1000 : nowMs;
  const next: Record<string, Aircraft> = {};
  const seen = new Set<string>();

  for (const report of reports) {
    if (seen.has(report.icao24)) continue;
    seen.add(report.icao24);
    const prior = prev[report.icao24];
    const missingFix = report.latitude == null || report.longitude == null;
    const latitude = missingFix ? (prior?.latitude ?? null) : report.latitude;
    const longitude = missingFix ? (prior?.longitude ?? null) : report.longitude;
    const positionHeld = missingFix && latitude != null && longitude != null;
    const status: TrackStatus = positionHeld || staleAtIngest(report, stamp) ? "stale" : "live";

    let observations = prior?.observations ?? [];
    if (!missingFix && latitude != null && longitude != null) {
      observations = appendObservation(observations, {
        t: report.timePosition ?? stamp / 1000,
        lat: latitude,
        lon: longitude,
        alt: report.baroAltitude,
        velocity: report.velocity,
        track: report.trueTrack,
        gap: false,
      });
    }

    if (!prior) {
      events.push(event("entered", report, nowMs, `${labelOf(report)} entered the region`));
    } else if (prior.status === "coasting" || prior.status === "departed") {
      events.push(event("returned", report, nowMs, `${labelOf(report)} is back in the feed`));
    }

    next[report.icao24] = {
      ...reportFields(report),
      latitude,
      longitude,
      status,
      positionHeld,
      firstSeen: prior?.firstSeen ?? nowMs,
      lastSeenInFeed: stamp,
      observations,
      lostNotified: false,
      departedNotified: false,
    };
  }

  for (const prior of Object.values(prev)) {
    if (seen.has(prior.icao24)) continue;
    const age = stamp - prior.lastSeenInFeed;
    if (age >= DROP_AFTER_MS) continue;

    const canCoast = prior.latitude != null && prior.longitude != null && age < DEPART_AFTER_MS;
    const status: TrackStatus = canCoast ? "coasting" : "departed";
    if (status === "coasting" && !prior.lostNotified) {
      events.push(event("lost", prior, nowMs, `${labelOf(prior)} dropped out — coasting on last vector`));
    }
    if (status === "departed" && !prior.departedNotified) {
      events.push(event("departed", prior, nowMs, `${labelOf(prior)} left the picture`));
    }

    next[prior.icao24] = {
      ...prior,
      status,
      lostNotified: prior.lostNotified || status === "coasting",
      departedNotified: prior.departedNotified || status === "departed",
    };
  }

  return { aircraft: next, events };
}
