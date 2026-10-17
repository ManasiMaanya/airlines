import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { MIN_UPSTREAM_INTERVAL_MS } from "@/lib/constants";
import { bboxArea, cacheKey, creditsForArea, overlapRatio, roundBBox } from "@/lib/geo";
import { openSkyClientFromEnv } from "@/lib/opensky/client";
import { parseStates } from "@/lib/parse";
import type { BBox, Report, StatesResponse } from "@/lib/types";

type Entry = {
  key: string;
  bbox: BBox;
  fetchedAt: number;
  upstreamTime: number | null;
  creditsRemaining: number | null;
  creditCost: number;
  areaSqDeg: number;
  aircraft: Report[];
};

type Memory = {
  entries: Map<string, Entry>;
  inflight: Map<string, Promise<StatesResponse>>;
};

const globalStore = globalThis as typeof globalThis & { __airspace?: Memory };

function memory(): Memory {
  if (!globalStore.__airspace) {
    globalStore.__airspace = { entries: new Map(), inflight: new Map() };
  }
  return globalStore.__airspace;
}

function diskPath(): string {
  const root = process.env.TMPDIR || process.env.TEMP || "/tmp";
  return path.join(root, "airspace-cache.json");
}

function readDisk(): Entry[] {
  try {
    const parsed = JSON.parse(readFileSync(diskPath(), "utf8")) as { entries?: Entry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writeDisk(entries: Entry[]) {
  try {
    const file = diskPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ entries: entries.slice(-8) }));
  } catch {
    // A read-only deploy still serves the in-memory cache and the recorded fallback.
  }
}

function remember(entry: Entry) {
  const mem = memory();
  mem.entries.set(entry.key, entry);
  const all = [...mem.entries.values()];
  writeDisk(all);
}

function cachedEntry(key: string): Entry | null {
  const mem = memory().entries.get(key);
  if (mem) return mem;
  const fromDisk = readDisk().find((entry) => entry.key === key);
  if (fromDisk) memory().entries.set(key, fromDisk);
  return fromDisk ?? null;
}

type FallbackFile = {
  recordedAt?: string;
  bbox: BBox;
  upstreamTime: number | null;
  states: unknown[];
};

let fallbackCache: FallbackFile | null | undefined;

function loadFallback(): FallbackFile | null {
  if (fallbackCache !== undefined) return fallbackCache;
  try {
    fallbackCache = JSON.parse(readFileSync(path.join(process.cwd(), "data", "fallback.json"), "utf8")) as FallbackFile;
  } catch {
    fallbackCache = null;
  }
  return fallbackCache;
}

function responseFrom(entry: Entry, status: StatesResponse["status"], message: string | null, retryAfterSec: number | null): StatesResponse {
  return {
    status,
    fetchedAt: entry.fetchedAt,
    upstreamTime: entry.upstreamTime,
    creditsRemaining: entry.creditsRemaining,
    creditCost: entry.creditCost,
    areaSqDeg: entry.areaSqDeg,
    message,
    retryAfterSec,
    bbox: entry.bbox,
    aircraft: entry.aircraft,
  };
}

function empty(bbox: BBox, message: string, retryAfterSec: number | null = null): StatesResponse {
  const areaSqDeg = bboxArea(bbox);
  return {
    status: "error",
    fetchedAt: null,
    upstreamTime: null,
    creditsRemaining: null,
    creditCost: creditsForArea(areaSqDeg),
    areaSqDeg,
    message,
    retryAfterSec,
    bbox,
    aircraft: [],
  };
}

function fallbackFor(bbox: BBox, creditCost: number, areaSqDeg: number, message: string): StatesResponse | null {
  const file = loadFallback();
  if (!file) return null;
  if (overlapRatio(bbox, file.bbox) < 0.5) return null;
  const aircraft = parseStates(file.states).filter((report) => {
    if (report.latitude == null || report.longitude == null) return true;
    return report.latitude >= bbox.lamin && report.latitude <= bbox.lamax && report.longitude >= bbox.lomin && report.longitude <= bbox.lomax;
  });
  return {
    status: "fallback",
    fetchedAt: file.upstreamTime != null ? file.upstreamTime * 1000 : null,
    upstreamTime: file.upstreamTime,
    creditsRemaining: null,
    creditCost,
    areaSqDeg,
    message,
    retryAfterSec: null,
    bbox,
    aircraft,
  };
}

async function fetchUpstream(bbox: BBox, cached: Entry | null): Promise<StatesResponse> {
  const rounded = roundBBox(bbox, 2);
  const areaSqDeg = bboxArea(rounded);
  const creditCost = creditsForArea(areaSqDeg);
  const result = await openSkyClientFromEnv().getStates({ bbox: rounded });
  if (!result.ok) {
    const recorded = `${result.message} Showing the recorded London snapshot.`;
    if (result.kind === "rate_limited") {
      if (cached) return responseFrom(cached, "rate_limited", result.message, result.retryAfterSec);
      return fallbackFor(rounded, creditCost, areaSqDeg, recorded) ?? empty(rounded, result.message, result.retryAfterSec);
    }
    if (cached) return responseFrom(cached, "cached", result.message, null);
    return fallbackFor(rounded, creditCost, areaSqDeg, recorded) ?? empty(rounded, result.message, result.retryAfterSec);
  }

  const entry: Entry = {
    key: cacheKey(rounded),
    bbox: rounded,
    fetchedAt: Date.now(),
    upstreamTime: result.time,
    creditsRemaining: result.creditsRemaining,
    creditCost,
    areaSqDeg,
    aircraft: result.aircraft,
  };
  remember(entry);
  return responseFrom(entry, "live", null, null);
}

export async function getStates(bbox: BBox): Promise<StatesResponse> {
  const key = cacheKey(bbox);
  const cached = cachedEntry(key);
  if (cached && Date.now() - cached.fetchedAt < MIN_UPSTREAM_INTERVAL_MS) {
    return responseFrom(cached, "cached", null, null);
  }

  const mem = memory();
  const existing = mem.inflight.get(key);
  if (existing) return existing;

  const pending = fetchUpstream(bbox, cached).finally(() => mem.inflight.delete(key));
  mem.inflight.set(key, pending);
  return pending;
}
