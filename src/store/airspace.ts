"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { evaluateAlerts } from "@/lib/alerts";
import { DEFAULT_RULES } from "@/lib/alerts";
import { bboxArea, creditsForArea, roundBBox, validBBox } from "@/lib/geo";
import { bindPoller, requestImmediatePoll } from "@/lib/poller";
import { DEFAULT_REGION } from "@/lib/regions";
import { mergeTracks } from "@/lib/track";
import type {
  ActiveAlert,
  Aircraft,
  AlertRule,
  BBox,
  FeedState,
  Filters,
  Region,
  ReplayState,
  Snapshot,
  StatesResponse,
  TrackEvent,
  Units,
} from "@/lib/types";

export type SortKey = "callsign" | "altitude" | "speed" | "seen";

type AirspaceState = {
  region: Region;
  filters: Filters;
  units: Units;
  refreshMs: number;
  trails: "selected" | "all";
  sort: SortKey;
  offline: boolean;
  follow: boolean;
  drawNonce: number;
  aircraft: Record<string, Aircraft>;
  selectedId: string | null;
  feed: FeedState;
  events: TrackEvent[];
  rules: AlertRule[];
  activeAlerts: Record<string, ActiveAlert>;
  snapshots: Snapshot[];
  replay: ReplayState;
  appliedUpstream: number | null;
  setRegion: (region: Region) => void;
  setCustomRegion: (bbox: BBox) => void;
  setFilters: (patch: Partial<Filters>) => void;
  setUnits: (units: Units) => void;
  setRefreshMs: (refreshMs: number) => void;
  setTrails: (trails: "selected" | "all") => void;
  setSort: (sort: SortKey) => void;
  setOffline: (offline: boolean) => void;
  setFollow: (follow: boolean) => void;
  requestDraw: () => void;
  select: (icao24: string | null) => void;
  toggleRule: (id: string) => void;
  addRule: (rule: AlertRule) => void;
  removeRule: (id: string) => void;
  setReplay: (patch: Partial<ReplayState>) => void;
  toggleReplay: () => void;
  refresh: () => Promise<number>;
  applyPayload: (payload: StatesResponse) => void;
  tickAlerts: () => void;
};

const initialFeed: FeedState = {
  status: "idle",
  loading: false,
  fetchedAt: null,
  upstreamTime: null,
  creditsRemaining: null,
  creditCost: 1,
  areaSqDeg: bboxArea(DEFAULT_REGION),
  message: null,
  retryAfterSec: null,
  count: 0,
};

const initialFilters: Filters = {
  query: "",
  phase: "all",
  minAlt: null,
  maxAlt: null,
  minSpeed: null,
  country: "all",
  emergenciesOnly: false,
  includeDeparted: false,
};

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

let requestGen = 0;

function feedFrom(payload: StatesResponse): FeedState {
  return {
    status: payload.status,
    loading: false,
    fetchedAt: payload.fetchedAt,
    upstreamTime: payload.upstreamTime,
    creditsRemaining: payload.creditsRemaining,
    creditCost: payload.creditCost,
    areaSqDeg: payload.areaSqDeg,
    message: payload.message,
    retryAfterSec: payload.retryAfterSec,
    count: payload.aircraft.length,
  };
}

function clearedPicture(region: Region, feed: FeedState): Partial<AirspaceState> {
  return {
    region,
    aircraft: {},
    snapshots: [],
    appliedUpstream: null,
    events: [],
    activeAlerts: {},
    selectedId: null,
    replay: { on: false, playing: false, index: 0, speed: 1 },
    feed: {
      ...feed,
      loading: true,
      status: "idle",
      message: null,
      count: 0,
      creditCost: creditsForArea(bboxArea(region)),
      areaSqDeg: bboxArea(region),
    },
  };
}

export const useAirspace = create<AirspaceState>()(
  persist(
    (set, get) => ({
      region: DEFAULT_REGION,
      filters: initialFilters,
      units: "aviation",
      refreshMs: 30_000,
      trails: "selected",
      sort: "altitude",
      offline: false,
      follow: false,
      drawNonce: 0,
      aircraft: {},
      selectedId: null,
      feed: initialFeed,
      events: [],
      rules: DEFAULT_RULES,
      activeAlerts: {},
      snapshots: [],
      replay: { on: false, playing: false, index: 0, speed: 1 },
      appliedUpstream: null,

      setRegion: (region) => {
        requestGen += 1;
        set(clearedPicture(region, get().feed));
        requestImmediatePoll();
      },

      setCustomRegion: (bbox) => {
        const problem = validBBox(bbox);
        if (problem) {
          set({ feed: { ...get().feed, message: problem } });
          return;
        }
        get().setRegion({ id: "custom", name: "Custom region", ...roundBBox(bbox, 2) });
      },

      setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
      setUnits: (units) => set({ units }),
      setRefreshMs: (refreshMs) => set({ refreshMs }),
      setTrails: (trails) => set({ trails }),
      setSort: (sort) => set({ sort }),
      setOffline: (offline) => {
        set({
          offline,
          feed: {
            ...get().feed,
            status: offline ? "offline" : get().feed.status === "offline" ? "cached" : get().feed.status,
            message: offline ? "Offline mode. Motion is estimated from the last vectors stored in this browser." : null,
          },
        });
        if (!offline) requestImmediatePoll();
      },
      setFollow: (follow) => set({ follow }),
      requestDraw: () => set({ drawNonce: get().drawNonce + 1 }),
      select: (selectedId) => set({ selectedId }),
      toggleRule: (id) =>
        set({
          rules: get().rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)),
        }),
      addRule: (rule) => set({ rules: [...get().rules, rule] }),
      removeRule: (id) => set({ rules: get().rules.filter((rule) => rule.id !== id || rule.locked) }),
      setReplay: (patch) => set({ replay: { ...get().replay, ...patch } }),
      toggleReplay: () => {
        const curr = get();
        if (curr.replay.on) {
          set({ replay: { ...curr.replay, on: false, playing: false } });
          requestImmediatePoll();
          return;
        }
        set({
          replay: {
            on: true,
            playing: false,
            index: Math.max(0, curr.snapshots.length - 1),
            speed: curr.replay.speed || 1,
          },
        });
      },

      applyPayload: (payload) => {
        const curr = get();
        const known = curr.appliedUpstream;
        const same = payload.upstreamTime != null && known != null && payload.upstreamTime === known;
        const older = payload.upstreamTime != null && known != null && payload.upstreamTime < known;
        if (same || (older && payload.status !== "live")) {
          set({ feed: { ...feedFrom(payload), message: payload.message ?? curr.feed.message } });
          return;
        }

        const usable =
          payload.status === "live" ||
          payload.status === "cached" ||
          payload.status === "fallback" ||
          (payload.status === "rate_limited" && payload.aircraft.length > 0);

        if (!usable) {
          set({ feed: feedFrom(payload) });
          return;
        }

        const now = Date.now();
        const merged = mergeTracks(curr.aircraft, payload.aircraft, now, payload.upstreamTime);
        const alerted = evaluateAlerts(Object.values(merged.aircraft), curr.rules, curr.activeAlerts, now);
        const snapshots = [
          ...curr.snapshots,
          { t: now, upstreamTime: payload.upstreamTime, reports: payload.aircraft } satisfies Snapshot,
        ].slice(-120);

        set({
          aircraft: merged.aircraft,
          events: [...alerted.events, ...merged.events, ...curr.events].slice(0, 80),
          activeAlerts: alerted.active,
          snapshots,
          appliedUpstream: payload.upstreamTime ?? known,
          feed: feedFrom(payload),
        });
      },

      tickAlerts: () => {
        const curr = get();
        if (curr.replay.on || curr.offline) return;
        const now = Date.now();
        const result = evaluateAlerts(Object.values(curr.aircraft), curr.rules, curr.activeAlerts, now);
        const changed =
          result.events.length > 0 || JSON.stringify(result.active) !== JSON.stringify(curr.activeAlerts);
        if (!changed) return;
        set({
          activeAlerts: result.active,
          events: [...result.events, ...curr.events].slice(0, 80),
        });
      },

      refresh: async () => {
        const gen = ++requestGen;
        const { region, refreshMs } = get();
        set({ feed: { ...get().feed, loading: true } });
        try {
          const params = new URLSearchParams({
            lamin: String(region.lamin),
            lomin: String(region.lomin),
            lamax: String(region.lamax),
            lomax: String(region.lomax),
          });
          const response = await fetch(`/api/states?${params}`, { cache: "no-store" });
          const payload = (await response.json()) as StatesResponse & { message?: string };
          if (gen !== requestGen) return get().refreshMs;
          if (!response.ok || !payload.aircraft) {
            const hasTracks = Object.keys(get().aircraft).length > 0;
            set({
              feed: {
                ...get().feed,
                loading: false,
                status: hasTracks ? "offline" : "error",
                message: payload.message ?? `Feed request failed (${response.status}).`,
              },
            });
            return Math.max(refreshMs, 20_000);
          }
          get().applyPayload(payload);
          const retry = (payload.retryAfterSec ?? 0) * 1000;
          return Math.max(refreshMs, Number.isFinite(retry) ? retry : 0, 15_000);
        } catch (error) {
          if (gen !== requestGen) return get().refreshMs;
          const hasTracks = Object.keys(get().aircraft).length > 0;
          const reason = error instanceof Error ? error.message : "Network request failed.";
          set({
            feed: {
              ...get().feed,
              loading: false,
              status: hasTracks ? "offline" : "error",
              message: hasTracks
                ? `${reason} The map is holding the last picture stored in this browser.`
                : reason,
            },
          });
          return Math.max(refreshMs, 20_000);
        }
      },
    }),
    {
      name: "airspace-v1",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : localStorage)),
      partialize: (state) => ({
        region: state.region,
        filters: state.filters,
        units: state.units,
        refreshMs: state.refreshMs,
        trails: state.trails,
        sort: state.sort,
        rules: state.rules,
        appliedUpstream: state.appliedUpstream,
        feed: { ...state.feed, loading: false },
        aircraft: Object.fromEntries(
          Object.values(state.aircraft)
            .filter((plane) => plane.status !== "departed")
            .slice(0, 800)
            .map((plane) => [plane.icao24, { ...plane, observations: plane.observations.slice(-10) }]),
        ),
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.feed.loading = false;
        state.offline = false;
        state.follow = false;
        state.replay = { on: false, playing: false, index: 0, speed: 1 };
      },
    },
  ),
);

bindPoller({
  refresh: () => useAirspace.getState().refresh(),
  shouldPause: () => {
    if (typeof document !== "undefined" && document.hidden) return true;
    const state = useAirspace.getState();
    return state.offline || state.replay.on;
  },
  tickAlerts: () => useAirspace.getState().tickAlerts(),
});
