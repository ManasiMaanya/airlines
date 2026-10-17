import type { Report } from "./types";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse one OpenSky state-vector row. Incomplete rows are kept, with nulls intact. */
export function parseState(row: unknown): Report | null {
  if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].trim() === "") return null;
  const callsign = str(row[1]);
  return {
    icao24: row[0].trim().toLowerCase(),
    callsign,
    originCountry: str(row[2]) ?? "Unknown",
    timePosition: num(row[3]),
    lastContact: num(row[4]),
    longitude: num(row[5]),
    latitude: num(row[6]),
    baroAltitude: num(row[7]),
    onGround: row[8] === true,
    velocity: num(row[9]),
    trueTrack: num(row[10]),
    verticalRate: num(row[11]),
    geoAltitude: num(row[13]),
    squawk: str(row[14]),
    spi: row[15] === true,
    positionSource: num(row[16]) ?? 0,
  };
}

export function parseStates(rows: unknown): Report[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, Report>();
  for (const row of rows) {
    const report = parseState(row);
    if (report) byId.set(report.icao24, report);
  }
  return [...byId.values()];
}
