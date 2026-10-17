"use client";

import { budgetMinutes, formatAge } from "@/lib/format";
import { requestImmediatePoll } from "@/lib/poller";
import { buildScene, visualStatus } from "@/lib/scene";
import { useAirspace } from "@/store/airspace";
import { useNow } from "./useNow";

const PILL: Record<string, string> = {
  idle: "text-muted border-line",
  live: "text-cyan border-cyan/40",
  cached: "text-paper border-line",
  rate_limited: "text-amber border-amber/50",
  fallback: "text-amber border-amber/50",
  error: "text-rose border-rose/50",
  offline: "text-amber border-amber/50",
};

const LABEL: Record<string, string> = {
  idle: "Connecting",
  live: "Live",
  cached: "Cached",
  rate_limited: "Rate limited",
  fallback: "Recorded",
  error: "Unavailable",
  offline: "Offline",
};

export function StatusBar() {
  const now = useNow();
  const region = useAirspace((state) => state.region);
  const feed = useAirspace((state) => state.feed);
  const aircraft = useAirspace((state) => state.aircraft);
  const snapshots = useAirspace((state) => state.snapshots);
  const replay = useAirspace((state) => state.replay);
  const filters = useAirspace((state) => state.filters);
  const selectedId = useAirspace((state) => state.selectedId);
  const units = useAirspace((state) => state.units);
  const refreshMs = useAirspace((state) => state.refreshMs);
  const offline = useAirspace((state) => state.offline);
  const setUnits = useAirspace((state) => state.setUnits);
  const setOffline = useAirspace((state) => state.setOffline);
  const activeAlerts = useAirspace((state) => state.activeAlerts);

  const scene = buildScene(aircraft, snapshots, replay, { ...filters, includeDeparted: true, query: "", phase: "all", country: "all", emergenciesOnly: false, minAlt: null, maxAlt: null, minSpeed: null }, selectedId, now);
  let airborne = 0;
  let ground = 0;
  let coasting = 0;
  for (const item of scene) {
    const status = replay.on ? item.status : visualStatus(item.aircraft, now);
    if (status === "coasting") coasting += 1;
    else if (item.aircraft.onGround) ground += 1;
    else if (status !== "departed") airborne += 1;
  }

  const age = feed.fetchedAt != null ? formatAge(now - feed.fetchedAt) : "—";
  const minutes = budgetMinutes(feed.creditsRemaining, feed.creditCost, refreshMs);
  const alertCount = Object.keys(activeAlerts).length;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
      <div className="mr-auto flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded bg-amber text-ink" aria-hidden>
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <path d="M8 1.2 11.2 13 8 10.4 4.8 13Z" />
          </svg>
        </span>
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold tracking-wide">Airspace</h1>
            <span className="font-mono text-[11px] text-muted">{region.name}</span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">OpenSky monitor</p>
        </div>
      </div>

      <div className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${PILL[feed.status]}`}>
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
        {LABEL[feed.status]}
        {feed.loading ? " · syncing" : ""}
        <span className="text-muted"> · {age}</span>
      </div>

      <p className="font-mono text-[11px] text-paper">
        {airborne} airborne · {ground} ground{coasting ? ` · ${coasting} coasting` : ""}
        {alertCount ? ` · ${alertCount} alerts` : ""}
      </p>

      <p className="font-mono text-[11px] text-muted">
        {feed.creditsRemaining == null ? "Credits —" : `${feed.creditsRemaining} credits`}
        {minutes != null ? ` · ~${minutes} min` : ""}
      </p>

      <div className="flex overflow-hidden rounded border border-line text-[11px]">
        <button type="button" className={`px-2 py-1 ${units === "aviation" ? "bg-panel-2 text-amber" : "text-muted"}`} onClick={() => setUnits("aviation")}>
          ft / kt
        </button>
        <button type="button" className={`px-2 py-1 ${units === "si" ? "bg-panel-2 text-amber" : "text-muted"}`} onClick={() => setUnits("si")}>
          m / m/s
        </button>
      </div>

      <button
        type="button"
        disabled={offline || feed.loading}
        onClick={() => requestImmediatePoll()}
        title="Request an immediate refresh from OpenSky"
        className="rounded border border-line px-2.5 py-1 text-[11px] text-muted hover:border-amber hover:text-amber disabled:opacity-50 cursor-pointer"
      >
        {feed.loading ? "Syncing…" : "Sync now"}
      </button>

      <button
        type="button"
        onClick={() => setOffline(!offline)}
        className={`rounded border px-2.5 py-1 text-[11px] cursor-pointer ${offline ? "border-amber text-amber" : "border-line text-muted"}`}
      >
        {offline ? "Resume live" : "Go offline"}
      </button>
    </header>
  );
}
