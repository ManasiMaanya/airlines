/** Anonymous OpenSky state vectors resolve every 10s, so faster polling wastes credits. */
export const MIN_UPSTREAM_INTERVAL_MS = 15_000;

/** A position older than this, relative to wall clock, is marked outdated. */
export const OUTDATED_AFTER_S = 75;

/** How long an aircraft missing from a newer snapshot keeps coasting. */
export const DEPART_AFTER_MS = 90_000;

/** Drop departed tracks after this so the session does not grow without bound. */
export const DROP_AFTER_MS = 180_000;

/** Dead-reckoning horizon. Beyond this the estimate freezes. */
export const MAX_EXTRAP_S = 180;

export const MAX_OBSERVATIONS = 40;

/** OpenSky charges 4 credits above this, and the payload becomes a world feed. */
export const MAX_REGION_SQ_DEG = 400;

export const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

export const POSITION_SOURCES = ["ADS-B", "ASTERIX", "MLAT", "FLARM"] as const;
