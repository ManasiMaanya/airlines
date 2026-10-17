"use client";

import { useEffect, useState } from "react";
import { bboxArea, creditsForArea, validBBox } from "@/lib/geo";
import { budgetMinutes, formatAge, toMeters, toMps } from "@/lib/format";
import { REGIONS } from "@/lib/regions";
import type { AlertKind, AlertRule, BBox } from "@/lib/types";
import { useAirspace } from "@/store/airspace";
import { useNow } from "./useNow";

const RATES = [
  { label: "20s", value: 20_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "2m", value: 120_000 },
];

export function Controls() {
  const now = useNow(2000);
  const region = useAirspace((state) => state.region);
  const setRegion = useAirspace((state) => state.setRegion);
  const requestDraw = useAirspace((state) => state.requestDraw);
  const filters = useAirspace((state) => state.filters);
  const setFilters = useAirspace((state) => state.setFilters);
  const units = useAirspace((state) => state.units);
  const refreshMs = useAirspace((state) => state.refreshMs);
  const setRefreshMs = useAirspace((state) => state.setRefreshMs);
  const trails = useAirspace((state) => state.trails);
  const setTrails = useAirspace((state) => state.setTrails);
  const rules = useAirspace((state) => state.rules);
  const toggleRule = useAirspace((state) => state.toggleRule);
  const addRule = useAirspace((state) => state.addRule);
  const removeRule = useAirspace((state) => state.removeRule);
  const aircraft = useAirspace((state) => state.aircraft);
  const events = useAirspace((state) => state.events);
  const feed = useAirspace((state) => state.feed);
  const activeAlerts = useAirspace((state) => state.activeAlerts);

  const countries = [...new Set(Object.values(aircraft).map((plane) => plane.originCountry))].sort();
  const area = bboxArea(region);
  const credits = creditsForArea(area);
  const minutes = budgetMinutes(feed.creditsRemaining, credits, refreshMs);

  const hasActiveFilters =
    Boolean(filters.query) ||
    filters.phase !== "all" ||
    filters.country !== "all" ||
    filters.minAlt != null ||
    filters.maxAlt != null ||
    filters.minSpeed != null ||
    filters.emergenciesOnly ||
    filters.includeDeparted;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-panel p-4">
      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Region</h2>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {REGIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={region.id === preset.id}
              onClick={() => setRegion(preset)}
              className={`rounded border px-2 py-1.5 text-left text-[13px] ${region.id === preset.id ? "border-amber bg-amber/10 text-amber" : "border-line text-paper hover:border-muted"}`}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted">
          {area.toFixed(2)} sq° · {credits} credit{credits === 1 ? "" : "s"} / request
          {minutes != null ? ` · about ${minutes} min of budget` : ""}
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={requestDraw} className="rounded border border-line px-2 py-1 text-[12px] text-paper hover:border-amber">
            Draw on map
          </button>
        </div>
        <BoundsForm />
      </section>

      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Refresh</h2>
        <div className="mt-2 flex gap-1">
          {RATES.map((rate) => (
            <button
              key={rate.value}
              type="button"
              onClick={() => setRefreshMs(rate.value)}
              className={`rounded border px-2 py-1 font-mono text-[11px] ${refreshMs === rate.value ? "border-amber text-amber" : "border-line text-muted"}`}
            >
              {rate.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          The proxy waits at least 15 seconds between OpenSky calls and reuses that snapshot for every browser poll. Anonymous access is 400 credits a day.
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Filters</h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() =>
                setFilters({
                  query: "",
                  phase: "all",
                  country: "all",
                  minAlt: null,
                  maxAlt: null,
                  minSpeed: null,
                  emergenciesOnly: false,
                  includeDeparted: false,
                })
              }
              className="font-mono text-[10px] text-amber hover:underline cursor-pointer"
            >
              Reset all
            </button>
          )}
        </div>
        <label className="mt-2 block text-[12px] text-muted">
          Callsign, ICAO, squawk, country
          <input
            value={filters.query}
            onChange={(event) => setFilters({ query: event.target.value })}
            className="mt-1 w-full rounded border border-line bg-ink px-2 py-1.5 text-[13px] text-text"
            placeholder="BAW, 7700, United…"
          />
        </label>
        <div className="mt-2 flex gap-1">
          {(["all", "airborne", "ground"] as const).map((phase) => (
            <button
              key={phase}
              type="button"
              onClick={() => setFilters({ phase })}
              className={`rounded border px-2 py-1 text-[12px] capitalize ${filters.phase === phase ? "border-cyan text-cyan" : "border-line text-muted"}`}
            >
              {phase}
            </button>
          ))}
        </div>
        <label className="mt-2 block text-[12px] text-muted">
          Country
          <select
            value={filters.country}
            onChange={(event) => setFilters({ country: event.target.value })}
            className="mt-1 w-full rounded border border-line bg-ink px-2 py-1.5 text-[13px] text-text"
          >
            <option value="all">All origins</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Threshold label={units === "si" ? "Min alt m" : "Min alt ft"} meters={filters.minAlt} kind="alt" units={units} onChange={(minAlt) => setFilters({ minAlt })} />
          <Threshold label={units === "si" ? "Max alt m" : "Max alt ft"} meters={filters.maxAlt} kind="alt" units={units} onChange={(maxAlt) => setFilters({ maxAlt })} />
          <Threshold label={units === "si" ? "Min m/s" : "Min kt"} meters={filters.minSpeed} kind="speed" units={units} onChange={(minSpeed) => setFilters({ minSpeed })} />
        </div>
        <label className="mt-2 flex items-center gap-2 text-[12px] text-paper">
          <input type="checkbox" checked={filters.emergenciesOnly} onChange={(event) => setFilters({ emergenciesOnly: event.target.checked })} />
          Emergency squawks only
        </label>
        <label className="mt-1 flex items-center gap-2 text-[12px] text-paper">
          <input type="checkbox" checked={filters.includeDeparted} onChange={(event) => setFilters({ includeDeparted: event.target.checked })} />
          Show aircraft that left
        </label>
        <div className="mt-2 flex gap-1">
          <button type="button" onClick={() => setTrails("selected")} className={`rounded border px-2 py-1 text-[12px] ${trails === "selected" ? "border-cyan text-cyan" : "border-line text-muted"}`}>
            Selected trail
          </button>
          <button type="button" onClick={() => setTrails("all")} className={`rounded border px-2 py-1 text-[12px] ${trails === "all" ? "border-cyan text-cyan" : "border-line text-muted"}`}>
            All trails
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Alerts</h2>
        <ul className="mt-2 space-y-1.5">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} aria-label={rule.name} />
              <span className="flex-1">{rule.name}</span>
              {!rule.locked && (
                <button type="button" className="text-[11px] text-muted hover:text-rose" onClick={() => removeRule(rule.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <AddAlert onAdd={addRule} regionBox={{ lamin: region.lamin, lomin: region.lomin, lamax: region.lamax, lomax: region.lomax }} units={units} />
        {Object.values(activeAlerts).length > 0 && (
          <ul className="mt-2 space-y-1">
            {Object.values(activeAlerts).slice(0, 4).map((alert) => (
              <li key={alert.key} className="rounded border border-rose/40 bg-rose/10 px-2 py-1 text-[12px] text-rose">
                {alert.callsign ?? alert.icao24.toUpperCase()} · {alert.ruleName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Traffic log</h2>
        <ul className="mt-2 space-y-1">
          {events.slice(0, 8).map((event) => (
            <li key={event.id} className="font-mono text-[11px] leading-relaxed text-muted">
              <span className="text-paper">{formatAge(now - event.t)}</span> {event.message}
            </li>
          ))}
          {events.length === 0 && <li className="text-[12px] text-muted">Entries and departures show up as the feed changes.</li>}
        </ul>
      </section>

      <details className="text-[12px] leading-relaxed text-muted">
        <summary className="cursor-pointer text-paper">How the feed stays up</summary>
        <p className="mt-2">
          Positions update on a timer, and the server refuses to call OpenSky again while a fresh snapshot is in memory. A 429, a timeout, or a dropped connection keeps that snapshot on the map. Aircraft that vanish for a short time coast on their last speed and track, then are marked departed. The recorded London response is used only when the live call fails and the selected region overlaps it.
        </p>
      </details>
    </div>
  );
}

function BoundsForm() {
  const region = useAirspace((state) => state.region);
  const setCustomRegion = useAirspace((state) => state.setCustomRegion);
  const [draft, setDraft] = useState({ lamin: "", lomin: "", lamax: "", lomax: "" });
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const bbox: BBox = {
      lamin: Number(draft.lamin || region.lamin),
      lomin: Number(draft.lomin || region.lomin),
      lamax: Number(draft.lamax || region.lamax),
      lomax: Number(draft.lomax || region.lomax),
    };
    const problem = validBBox(bbox);
    setError(problem);
    if (!problem) setCustomRegion(bbox);
  }

  return (
    <form
      className="mt-2 grid grid-cols-2 gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {(["lamin", "lomin", "lamax", "lomax"] as const).map((key) => (
        <label key={key} className="font-mono text-[10px] text-muted">
          {key}
          <input
            value={draft[key]}
            placeholder={String(region[key])}
            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
            className="mt-0.5 w-full rounded border border-line bg-ink px-1.5 py-1 text-[12px] text-text"
          />
        </label>
      ))}
      <button type="submit" className="col-span-2 rounded border border-line py-1 text-[12px] text-paper hover:border-amber">
        Apply bounds
      </button>
      {error && <p className="col-span-2 text-[12px] text-rose">{error}</p>}
    </form>
  );
}

function Threshold({
  label,
  meters,
  kind,
  units,
  onChange,
}: {
  label: string;
  meters: number | null;
  kind: "alt" | "speed";
  units: "aviation" | "si";
  onChange: (value: number | null) => void;
}) {
  const shown =
    meters == null ? "" : String(Math.round(kind === "alt" ? (units === "si" ? meters : meters * 3.28084) : units === "si" ? meters : meters * 1.943844));
  const [text, setText] = useState(shown);
  useEffect(() => {
    setText(shown);
  }, [shown]);

  return (
    <label className="font-mono text-[10px] text-muted">
      {label}
      <input
        data-threshold={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text.trim() === "") {
            onChange(null);
            return;
          }
          const value = Number(text);
          if (!Number.isFinite(value)) return;
          if (kind === "alt") onChange(units === "si" ? value : toMeters(value));
          else onChange(units === "si" ? value : toMps(value));
        }}
        className="mt-0.5 w-full rounded border border-line bg-ink px-1.5 py-1 text-[12px] text-text"
      />
    </label>
  );
}

function AddAlert({
  onAdd,
  regionBox,
  units,
}: {
  onAdd: (rule: AlertRule) => void;
  regionBox: BBox;
  units: "aviation" | "si";
}) {
  const [kind, setKind] = useState<AlertKind>("altitude_above");
  const [value, setValue] = useState("35000");

  function submit() {
    const numeric = Number(value);
    if (kind !== "inside_box" && !Number.isFinite(numeric)) return;
    const meters = kind.startsWith("altitude") ? (units === "si" ? numeric : toMeters(numeric)) : null;
    const metersPerSec = kind === "speed_above" ? (units === "si" ? numeric : toMps(numeric)) : null;
    const name =
      kind === "inside_box"
        ? "Inside current region"
        : kind === "speed_above"
          ? `Faster than ${value} ${units === "si" ? "m/s" : "kt"}`
          : kind === "altitude_above"
            ? `Above ${value} ${units === "si" ? "m" : "ft"}`
            : `Below ${value} ${units === "si" ? "m" : "ft"}`;
    onAdd({
      id: `rule-${Date.now()}`,
      name,
      enabled: true,
      kind,
      meters,
      metersPerSec,
      box: kind === "inside_box" ? regionBox : null,
      locked: false,
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <select value={kind} onChange={(event) => setKind(event.target.value as AlertKind)} className="rounded border border-line bg-ink px-1.5 py-1 text-[12px]">
        <option value="altitude_above">Altitude above</option>
        <option value="altitude_below">Altitude below</option>
        <option value="speed_above">Speed above</option>
        <option value="inside_box">Inside this region</option>
      </select>
      {kind !== "inside_box" && (
        <input value={value} onChange={(event) => setValue(event.target.value)} className="w-20 rounded border border-line bg-ink px-1.5 py-1 text-[12px]" />
      )}
      <button type="button" onClick={submit} className="rounded border border-line px-2 py-1 text-[12px] text-paper">
        Add
      </button>
    </div>
  );
}
