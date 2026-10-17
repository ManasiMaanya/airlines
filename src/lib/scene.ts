import { OUTDATED_AFTER_S } from "./constants";
import { isEmergencySquawk } from "./format";
import { lerpAngle, lerpNullable } from "./geo";
import { predict } from "./predict";
import type { Aircraft, Filters, ReplayState, Report, SceneItem, Snapshot, TrackStatus } from "./types";

export function visualStatus(aircraft: Aircraft, nowMs: number): TrackStatus {
  if (aircraft.status === "departed") return "departed";
  if (aircraft.status === "coasting") return "coasting";
  if (aircraft.positionHeld || aircraft.timePosition == null) return "stale";
  if (nowMs / 1000 - aircraft.timePosition > OUTDATED_AFTER_S) return "stale";
  return aircraft.status === "stale" ? "stale" : "live";
}

function matches(aircraft: Aircraft, filters: Filters, nowMs: number): boolean {
  const status = visualStatus(aircraft, nowMs);
  if (status === "departed" && !filters.includeDeparted) return false;
  if (filters.phase === "airborne" && aircraft.onGround) return false;
  if (filters.phase === "ground" && !aircraft.onGround) return false;
  if (filters.country !== "all" && aircraft.originCountry !== filters.country) return false;
  if (filters.emergenciesOnly && !isEmergencySquawk(aircraft.squawk)) return false;
  if (filters.minAlt != null && (aircraft.baroAltitude == null || aircraft.baroAltitude < filters.minAlt)) return false;
  if (filters.maxAlt != null && (aircraft.baroAltitude == null || aircraft.baroAltitude > filters.maxAlt)) return false;
  if (filters.minSpeed != null && (aircraft.velocity == null || aircraft.velocity < filters.minSpeed)) return false;
  const q = filters.query.trim().toLowerCase();
  if (!q) return true;
  return (
    aircraft.icao24.includes(q) ||
    (aircraft.callsign?.toLowerCase().includes(q) ?? false) ||
    aircraft.originCountry.toLowerCase().includes(q) ||
    (aircraft.squawk?.toLowerCase().includes(q) ?? false)
  );
}

function fromReport(report: Report, observations: Aircraft["observations"]): Aircraft {
  return {
    ...report,
    status: "live",
    positionHeld: report.latitude == null || report.longitude == null,
    firstSeen: observations[0] ? observations[0].t * 1000 : 0,
    lastSeenInFeed: report.timePosition != null ? report.timePosition * 1000 : 0,
    observations,
    lostNotified: false,
    departedNotified: false,
  };
}

function reportsAt(snapshots: Snapshot[], index: number): Report[] {
  if (snapshots.length === 0) return [];
  const max = snapshots.length - 1;
  const clamped = Math.min(Math.max(index, 0), max);
  const i = Math.floor(clamped);
  const f = clamped - i;
  const left = snapshots[i].reports;
  if (i >= max || f < 0.001) return left;
  const right = new Map(snapshots[i + 1].reports.map((report) => [report.icao24, report]));
  const ids = new Set<string>([...left.map((r) => r.icao24), ...right.keys()]);
  const leftMap = new Map(left.map((report) => [report.icao24, report]));
  const blended: Report[] = [];

  for (const id of ids) {
    const a = leftMap.get(id);
    const b = right.get(id);
    if (a && b && a.latitude != null && b.latitude != null && a.longitude != null && b.longitude != null) {
      blended.push({
        ...a,
        latitude: a.latitude + (b.latitude - a.latitude) * f,
        longitude: a.longitude + (b.longitude - a.longitude) * f,
        baroAltitude: lerpNullable(a.baroAltitude, b.baroAltitude, f),
        velocity: lerpNullable(a.velocity, b.velocity, f),
        trueTrack: a.trueTrack != null && b.trueTrack != null ? lerpAngle(a.trueTrack, b.trueTrack, f) : (a.trueTrack ?? b.trueTrack),
        verticalRate: lerpNullable(a.verticalRate, b.verticalRate, f),
      });
    } else if (a && f < 0.65) {
      blended.push(a);
    } else if (b && f >= 0.35) {
      blended.push(b);
    }
  }
  return blended;
}

function trailFromSnapshots(snapshots: Snapshot[], index: number, icao24: string): Aircraft["observations"] {
  const end = Math.min(snapshots.length - 1, Math.floor(index));
  const points: Aircraft["observations"] = [];
  for (let i = 0; i <= end; i++) {
    const report = snapshots[i].reports.find((item) => item.icao24 === icao24);
    if (!report || report.latitude == null || report.longitude == null) continue;
    points.push({
      t: report.timePosition ?? snapshots[i].t / 1000,
      lat: report.latitude,
      lon: report.longitude,
      alt: report.baroAltitude,
      velocity: report.velocity,
      track: report.trueTrack,
      gap: false,
    });
  }
  return points.slice(-40);
}

export function buildScene(
  aircraft: Record<string, Aircraft>,
  snapshots: Snapshot[],
  replay: ReplayState,
  filters: Filters,
  selectedId: string | null,
  nowMs: number,
): SceneItem[] {
  if (replay.on && snapshots.length > 0) {
    const frame = reportsAt(snapshots, replay.index);
    return frame
      .map((report) => {
        const trail = trailFromSnapshots(snapshots, replay.index, report.icao24);
        const synthetic = fromReport(report, trail);
        const fractional = replay.index - Math.floor(replay.index) > 0.02 && replay.index < snapshots.length - 1;
        return {
          aircraft: synthetic,
          lat: report.latitude,
          lon: report.longitude,
          alt: report.baroAltitude,
          track: report.trueTrack,
          speed: report.velocity,
          extrapolated: fractional,
          frozen: false,
          dt: 0,
          status: "live" as const,
        };
      })
      .filter((item) => item.aircraft.icao24 === selectedId || matches(item.aircraft, filters, nowMs));
  }

  const items: SceneItem[] = [];
  for (const plane of Object.values(aircraft)) {
    if (plane.icao24 !== selectedId && !matches(plane, filters, nowMs)) continue;
    const status = visualStatus(plane, nowMs);
    const motion = predict(plane, nowMs);
    items.push({
      aircraft: plane,
      lat: motion?.lat ?? plane.latitude,
      lon: motion?.lon ?? plane.longitude,
      alt: motion?.alt ?? plane.baroAltitude,
      track: plane.trueTrack,
      speed: plane.velocity,
      extrapolated: motion?.extrapolated ?? false,
      frozen: motion?.frozen ?? false,
      dt: motion?.dt ?? 0,
      status,
    });
  }
  return items;
}

export function sortScene(items: SceneItem[], sort: "callsign" | "altitude" | "speed" | "seen"): SceneItem[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (sort === "altitude") return (b.aircraft.baroAltitude ?? -1) - (a.aircraft.baroAltitude ?? -1);
    if (sort === "speed") return (b.speed ?? -1) - (a.speed ?? -1);
    if (sort === "seen") return b.aircraft.lastSeenInFeed - a.aircraft.lastSeenInFeed;
    const an = a.aircraft.callsign ?? a.aircraft.icao24;
    const bn = b.aircraft.callsign ?? b.aircraft.icao24;
    return an.localeCompare(bn);
  });
  return copy;
}
