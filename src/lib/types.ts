export type BBox = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

export type Region = BBox & {
  id: string;
  name: string;
};

export type Units = "aviation" | "si";

export type TrackStatus = "live" | "stale" | "coasting" | "departed";

export type FeedStatus =
  | "idle"
  | "live"
  | "cached"
  | "rate_limited"
  | "fallback"
  | "error"
  | "offline";

/** One OpenSky state vector, normalized. Nulls are preserved. */
export type Report = {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number | null;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: number;
};

export type Observation = {
  /** Unix seconds of the report this point came from. */
  t: number;
  lat: number;
  lon: number;
  alt: number | null;
  velocity: number | null;
  track: number | null;
  /** True when this point should not be connected to the previous one. */
  gap: boolean;
};

export type Aircraft = Report & {
  status: TrackStatus;
  /** Last known coordinates kept after a report omitted them. */
  positionHeld: boolean;
  firstSeen: number;
  /** Unix ms of the feed snapshot that last included this aircraft. */
  lastSeenInFeed: number;
  observations: Observation[];
  lostNotified: boolean;
  departedNotified: boolean;
};

export type TrackEvent = {
  id: string;
  t: number;
  kind: "entered" | "departed" | "lost" | "returned" | "alert";
  icao24: string;
  callsign: string | null;
  message: string;
};

export type AlertKind =
  | "squawk_emergency"
  | "altitude_above"
  | "altitude_below"
  | "speed_above"
  | "inside_box";

export type AlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  kind: AlertKind;
  /** Threshold in meters for altitude rules. */
  meters: number | null;
  /** Threshold in m/s for speed rules. */
  metersPerSec: number | null;
  box: BBox | null;
  locked: boolean;
};

export type ActiveAlert = {
  key: string;
  ruleId: string;
  ruleName: string;
  icao24: string;
  callsign: string | null;
  since: number;
  detail: string;
};

export type Snapshot = {
  t: number;
  upstreamTime: number | null;
  reports: Report[];
};

export type FeedState = {
  status: FeedStatus;
  loading: boolean;
  fetchedAt: number | null;
  upstreamTime: number | null;
  creditsRemaining: number | null;
  creditCost: number;
  areaSqDeg: number;
  message: string | null;
  retryAfterSec: number | null;
  count: number;
};

export type StatesResponse = {
  status: Exclude<FeedStatus, "idle" | "offline">;
  fetchedAt: number | null;
  upstreamTime: number | null;
  creditsRemaining: number | null;
  creditCost: number;
  areaSqDeg: number;
  message: string | null;
  retryAfterSec: number | null;
  bbox: BBox;
  aircraft: Report[];
};

export type Filters = {
  query: string;
  phase: "all" | "airborne" | "ground";
  /** Meters. Null means unbounded. */
  minAlt: number | null;
  maxAlt: number | null;
  minSpeed: number | null;
  country: string;
  emergenciesOnly: boolean;
  includeDeparted: boolean;
};

export type ReplayState = {
  on: boolean;
  playing: boolean;
  index: number;
  speed: number;
};

export type SceneItem = {
  aircraft: Aircraft;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  track: number | null;
  speed: number | null;
  extrapolated: boolean;
  frozen: boolean;
  /** Seconds the estimate extends past the last position report. */
  dt: number;
  status: TrackStatus;
};
