import { isEmergencySquawk, emergencyLabel, formatAlt, formatSpeed } from "./format";
import { contains } from "./geo";
import { predict } from "./predict";
import type { ActiveAlert, Aircraft, AlertRule, TrackEvent } from "./types";

function sample(aircraft: Aircraft, nowMs: number) {
  const motion = predict(aircraft, nowMs);
  return {
    lat: motion?.lat ?? aircraft.latitude,
    lon: motion?.lon ?? aircraft.longitude,
    alt: motion?.alt ?? aircraft.baroAltitude,
    speed: aircraft.velocity,
  };
}

function detailFor(rule: AlertRule, aircraft: Aircraft, nowMs: number): string | null {
  if (aircraft.status === "departed") return null;
  const point = sample(aircraft, nowMs);
  switch (rule.kind) {
    case "squawk_emergency":
      return aircraft.squawk && isEmergencySquawk(aircraft.squawk) ? emergencyLabel(aircraft.squawk) : null;
    case "altitude_above":
      if (aircraft.onGround || point.alt == null || rule.meters == null || point.alt < rule.meters) return null;
      return formatAlt(point.alt, "aviation");
    case "altitude_below":
      if (aircraft.onGround || point.alt == null || rule.meters == null || point.alt > rule.meters) return null;
      return formatAlt(point.alt, "aviation");
    case "speed_above":
      if (point.speed == null || rule.metersPerSec == null || point.speed < rule.metersPerSec) return null;
      return formatSpeed(point.speed, "aviation");
    case "inside_box": {
      if (!rule.box || point.lat == null || point.lon == null) return null;
      if (!contains(rule.box, point.lat, point.lon)) return null;
      return "inside watch box";
    }
    default:
      return null;
  }
}

export function evaluateAlerts(
  aircraft: Aircraft[],
  rules: AlertRule[],
  previous: Record<string, ActiveAlert>,
  nowMs: number,
): { active: Record<string, ActiveAlert>; events: TrackEvent[] } {
  const active: Record<string, ActiveAlert> = {};
  const events: TrackEvent[] = [];
  const enabled = rules.filter((rule) => rule.enabled);

  for (const plane of aircraft) {
    for (const rule of enabled) {
      const detail = detailFor(rule, plane, nowMs);
      if (!detail) continue;
      const key = `${rule.id}:${plane.icao24}`;
      const prior = previous[key];
      active[key] = prior ?? {
        key,
        ruleId: rule.id,
        ruleName: rule.name,
        icao24: plane.icao24,
        callsign: plane.callsign,
        since: nowMs,
        detail,
      };
      if (!prior) {
        const name = plane.callsign ?? plane.icao24.toUpperCase();
        events.push({
          id: `alert-${key}-${nowMs}`,
          t: nowMs,
          kind: "alert",
          icao24: plane.icao24,
          callsign: plane.callsign,
          message: `${name} · ${rule.name} · ${detail}`,
        });
      } else {
        active[key] = { ...prior, detail, callsign: plane.callsign };
      }
    }
  }

  return { active, events };
}

export const DEFAULT_RULES: AlertRule[] = [
  {
    id: "emergency-squawk",
    name: "Emergency squawk",
    enabled: true,
    kind: "squawk_emergency",
    meters: null,
    metersPerSec: null,
    box: null,
    locked: true,
  },
  {
    id: "fast",
    name: "Faster than 500 kt",
    enabled: true,
    kind: "speed_above",
    meters: null,
    metersPerSec: 257.2,
    box: null,
    locked: true,
  },
  {
    id: "low",
    name: "Airborne below 1,000 ft",
    enabled: false,
    kind: "altitude_below",
    meters: 304.8,
    metersPerSec: null,
    box: null,
    locked: true,
  },
];
