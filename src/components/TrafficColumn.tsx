"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pathLength } from "@/lib/geo";
import {
  callsignOrIcao,
  formatAge,
  formatAlt,
  formatCoord,
  formatFlightLevel,
  formatSpeed,
  formatTrack,
  formatVertical,
  isEmergencySquawk,
  positionSourceLabel,
} from "@/lib/format";
import { buildScene, sortScene } from "@/lib/scene";
import type { Observation, SceneItem } from "@/lib/types";
import { useAirspace, type SortKey } from "@/store/airspace";
import { useNow } from "./useNow";

const ROW = 64;

export function TrafficColumn() {
  const now = useNow();
  const aircraft = useAirspace((state) => state.aircraft);
  const snapshots = useAirspace((state) => state.snapshots);
  const replay = useAirspace((state) => state.replay);
  const filters = useAirspace((state) => state.filters);
  const selectedId = useAirspace((state) => state.selectedId);
  const select = useAirspace((state) => state.select);
  const sort = useAirspace((state) => state.sort);
  const setSort = useAirspace((state) => state.setSort);
  const units = useAirspace((state) => state.units);
  const follow = useAirspace((state) => state.follow);
  const setFollow = useAirspace((state) => state.setFollow);
  const activeAlerts = useAirspace((state) => state.activeAlerts);

  const items = useMemo(() => {
    const scene = buildScene(aircraft, snapshots, replay, filters, selectedId, now);
    return sortScene(scene, sort);
  }, [aircraft, snapshots, replay, filters, selectedId, now, sort]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(360);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const index = items.findIndex((item) => item.aircraft.icao24 === selectedId);
    const node = scroller.current;
    if (index < 0 || !node) return;
    const top = index * ROW;
    if (top < node.scrollTop || top > node.scrollTop + node.clientHeight - ROW) {
      node.scrollTop = Math.max(0, top - 48);
    }
  }, [selectedId, items]);

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 4);
  const end = Math.min(items.length, start + Math.ceil(height / ROW) + 8);
  const selected = items.find((item) => item.aircraft.icao24 === selectedId) ?? null;
  const alerted = new Set(Object.values(activeAlerts).map((alert) => alert.icao24));

  return (
    <aside className="flex h-full min-h-0 flex-col border-line bg-panel lg:w-[360px] lg:border-l">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Traffic</h2>
        <span className="font-mono text-[11px] text-paper">{items.length}</span>
        <select
          aria-label="Sort aircraft"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="ml-auto rounded border border-line bg-ink px-1.5 py-1 text-[12px]"
        >
          <option value="altitude">Altitude</option>
          <option value="speed">Speed</option>
          <option value="callsign">Callsign</option>
          <option value="seen">Last seen</option>
        </select>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-[13px] leading-relaxed text-muted">No aircraft match this region and filter. Widen the box or clear a filter.</p>
        ) : (
          <div style={{ height: items.length * ROW, position: "relative" }}>
            {items.slice(start, end).map((item, offset) => {
              const index = start + offset;
              const id = item.aircraft.icao24;
              const active = id === selectedId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => select(id)}
                  className={`absolute right-0 left-0 flex items-center gap-3 border-b border-line/70 px-3 text-left cursor-pointer transition-colors ${active ? "bg-amber/10 border-l-2 border-l-amber" : "hover:bg-panel-2"}`}
                  style={{ top: index * ROW, height: ROW }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(item, alerted.has(id))}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{callsignOrIcao(item.aircraft.callsign, id)}</span>
                      <span className="font-mono text-[12px] text-paper flex items-center gap-1">
                        {formatAlt(item.aircraft.baroAltitude, units, item.aircraft.onGround)}
                        {!item.aircraft.onGround && item.aircraft.verticalRate != null && Math.abs(item.aircraft.verticalRate) > 0.8 && (
                          <span className={`text-[10px] ${item.aircraft.verticalRate > 0 ? "text-cyan" : "text-amber"}`}>
                            {item.aircraft.verticalRate > 0 ? "▲" : "▼"}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 flex justify-between font-mono text-[11px] text-muted">
                      <span className="truncate">{item.aircraft.originCountry}</span>
                      <span>
                        {formatSpeed(item.speed, units)} {formatTrack(item.track)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <Detail item={selected} units={units} now={now} follow={follow} setFollow={setFollow} replay={replay.on} />
    </aside>
  );
}

function dotClass(item: SceneItem, alerted: boolean): string {
  if (alerted || isEmergencySquawk(item.aircraft.squawk)) return "bg-rose";
  if (item.status === "coasting") return "bg-amber";
  if (item.status === "stale") return "bg-paper/70";
  if (item.status === "departed") return "bg-muted";
  if (item.aircraft.onGround) return "bg-muted";
  return "bg-cyan";
}

function Detail({
  item,
  units,
  now,
  follow,
  setFollow,
  replay,
}: {
  item: SceneItem | null;
  units: "aviation" | "si";
  now: number;
  follow: boolean;
  setFollow: (follow: boolean) => void;
  replay: boolean;
}) {
  if (!item) {
    return (
      <div className="border-t border-line px-3 py-3 text-[13px] leading-relaxed text-muted">
        Select an aircraft to read altitude, speed, heading, and the trail this session has collected.
      </div>
    );
  }
  const plane = item.aircraft;
  const reportedAge = plane.timePosition == null ? null : now - plane.timePosition * 1000;
  const level = formatFlightLevel(plane.baroAltitude);
  const distance = pathLength(plane.observations);

  return (
    <div className="max-h-[48%] overflow-y-auto border-t border-line px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{callsignOrIcao(plane.callsign, plane.icao24)}</h3>
          <p className="font-mono text-[12px] text-muted">
            {plane.icao24.toUpperCase()} · {plane.originCountry}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(plane.icao24);
              }
            }}
            title="Copy ICAO24 hex identifier"
            className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:border-paper hover:text-paper cursor-pointer"
          >
            Copy Hex
          </button>
          <button
            type="button"
            onClick={() => setFollow(!follow)}
            className={`rounded border px-2 py-1 text-[11px] cursor-pointer ${follow ? "border-amber text-amber font-semibold" : "border-line text-muted"}`}
          >
            {follow ? "Following" : "Follow"}
          </button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        <Fact label="Status" value={statusCopy(item, replay)} />
        <Fact label="Squawk" value={plane.squawk ?? "—"} warn={isEmergencySquawk(plane.squawk)} />
        <Fact label="Altitude" value={`${formatAlt(plane.baroAltitude, units, plane.onGround)}${level ? ` · ${level}` : ""}`} />
        <Fact label="Geometric" value={formatAlt(plane.geoAltitude, units)} />
        <Fact label="Ground speed" value={formatSpeed(item.speed, units)} />
        <Fact label="Vertical" value={formatVertical(plane.verticalRate, units)} />
        <Fact label="Track" value={formatTrack(item.track)} />
        <Fact label="Source" value={positionSourceLabel(plane.positionSource)} />
        <Fact label="Last report" value={reportedAge == null ? "—" : formatAge(reportedAge)} />
        <Fact label="Last contact" value={plane.lastContact == null ? "—" : formatAge(now - plane.lastContact * 1000)} />
      </dl>
      {!plane.onGround && (
        <div className="mt-3 rounded border border-line/60 bg-ink/70 p-2.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-muted">
            <span>ALTITUDE TAPE</span>
            <span className="text-paper">{level ?? `${Math.round(plane.baroAltitude ?? 0)}m`}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full bg-gradient-to-r from-cyan to-amber transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, ((plane.baroAltitude ?? 0) / 13000) * 100))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted">
            <span>SPEED TAPE</span>
            <span className="text-paper">{formatSpeed(item.speed, units)}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-cyan transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, ((item.speed ?? 0) / 300) * 100))}%` }}
            />
          </div>
        </div>
      )}
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-paper">
        {plane.latitude != null && plane.longitude != null ? `Reported ${formatCoord(plane.latitude, plane.longitude)}` : "No position in the latest report."}
        {plane.positionHeld ? " Coordinates held from the previous fix." : ""}
      </p>
      {item.extrapolated && (
        <p className="mt-1 text-[12px] leading-relaxed text-amber">
          {item.frozen
            ? "Estimate held. The last vector is too old to project further."
            : replay
              ? "Position interpolated between snapshots collected this session."
              : `Estimated ${Math.round(item.dt)}s past the last report, using ground speed and track.`}
          {item.lat != null && item.lon != null ? ` ${formatCoord(item.lat, item.lon)}` : ""}
        </p>
      )}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <h4 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Session trail</h4>
          <span className="font-mono text-[11px] text-muted">
            {plane.observations.length} pts · {(distance / 1000).toFixed(1)} km
          </span>
        </div>
        <Spark points={plane.observations} />
        <ul className="mt-2 space-y-1">
          {plane.observations
            .slice(-5)
            .reverse()
            .map((point) => (
              <li key={`${point.t}-${point.lat}`} className="font-mono text-[11px] text-muted">
                {formatCoord(point.lat, point.lon)} · {formatAlt(point.alt, units)} · {formatSpeed(point.velocity, units)}
              </li>
            ))}
          {plane.observations.length === 0 && <li className="text-[12px] text-muted">Waiting for a position report.</li>}
        </ul>
      </div>
    </div>
  );
}

function statusCopy(item: SceneItem, replay: boolean): string {
  if (replay) return "Replay";
  if (item.status === "coasting") return "Coasting";
  if (item.status === "departed") return "Departed";
  if (item.status === "stale" || item.aircraft.positionHeld) return "Outdated fix";
  return item.aircraft.onGround ? "On ground" : "Airborne";
}

function Fact({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono ${warn ? "text-rose" : "text-paper"}`}>{value}</dd>
    </div>
  );
}

function Spark({ points }: { points: Observation[] }) {
  const alts = points.map((point) => point.alt).filter((alt): alt is number => alt != null);
  if (alts.length < 2) return null;
  const min = Math.min(...alts);
  const max = Math.max(...alts);
  const span = max - min || 1;
  const d = alts
    .map((alt, index) => {
      const x = (index / (alts.length - 1)) * 120;
      const y = 28 - ((alt - min) / span) * 24;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 120 32" className="mt-2 h-8 w-full" aria-hidden>
      <path d={d} fill="none" stroke="#5eead4" strokeWidth="1.5" />
    </svg>
  );
}
