import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAlerts, DEFAULT_RULES } from "./alerts";
import { bboxArea, creditsForArea, haversine, lerpAngle, overlapRatio, project, validBBox } from "./geo";
import { parseState } from "./parse";
import { predict } from "./predict";
import { buildScene, visualStatus } from "./scene";
import { mergeTracks } from "./track";
import type { Aircraft, AlertRule, Filters, Report, Snapshot } from "./types";

function report(overrides: Partial<Report> = {}): Report {
  return {
    icao24: "abc123",
    callsign: "TST1",
    originCountry: "United Kingdom",
    timePosition: 1_000,
    lastContact: 1_000,
    longitude: 0,
    latitude: 51,
    baroAltitude: 1000,
    onGround: false,
    velocity: 100,
    trueTrack: 0,
    verticalRate: 0,
    geoAltitude: 1100,
    squawk: "2000",
    spi: false,
    positionSource: 0,
    ...overrides,
  };
}

function tracked(partial: Partial<Aircraft>): Aircraft {
  const base = report();
  return {
    ...base,
    status: "live",
    positionHeld: false,
    firstSeen: 0,
    lastSeenInFeed: 0,
    observations: [],
    lostNotified: false,
    departedNotified: false,
    ...partial,
  };
}

describe("opensky parsing", () => {
  it("keeps null fields and trims the callsign", () => {
    const parsed = parseState(["AbC123", "  BAW1  ", "United Kingdom", null, 10, null, null, null, false, null, null, null, null, null, null, false, 0]);
    assert.ok(parsed);
    assert.equal(parsed.icao24, "abc123");
    assert.equal(parsed.callsign, "BAW1");
    assert.equal(parsed.latitude, null);
    assert.equal(parsed.baroAltitude, null);
    assert.equal(parsed.timePosition, null);
  });

  it("rejects a row without an address", () => {
    assert.equal(parseState([null, "X"]), null);
  });
});

describe("regions and credits", () => {
  it("prices bounding boxes the way OpenSky does", () => {
    assert.equal(creditsForArea(25), 1);
    assert.equal(creditsForArea(25.01), 2);
    assert.equal(creditsForArea(100), 2);
    assert.equal(creditsForArea(100.01), 3);
    assert.equal(creditsForArea(400), 3);
    assert.equal(creditsForArea(400.01), 4);
  });

  it("rejects a box that crosses the antimeridian or is huge", () => {
    assert.ok(validBBox({ lamin: 10, lomin: 170, lamax: 20, lomax: -170 }));
    assert.ok(validBBox({ lamin: 0, lomin: 0, lamax: 30, lomax: 30 }));
    assert.equal(validBBox({ lamin: 51, lomin: -1, lamax: 52, lomax: 1 }), null);
    assert.ok(bboxArea({ lamin: 51.2, lomin: -0.55, lamax: 51.75, lomax: 0.25 }) < 1);
  });
});

describe("dead reckoning", () => {
  it("projects due north from speed and track", () => {
    const result = predict(
      {
        latitude: 51,
        longitude: 0,
        baroAltitude: 1000,
        velocity: 100,
        trueTrack: 0,
        verticalRate: 0,
        onGround: false,
        timePosition: 1_000,
      },
      1_010_000,
    );
    assert.ok(result);
    assert.equal(result.extrapolated, true);
    assert.ok(result.lat > 51.008 && result.lat < 51.011);
    assert.ok(Math.abs(result.lon) < 0.001);
    const moved = project(51, 0, 0, 1000);
    assert.ok(Math.abs(moved.lat - result.lat) < 1e-6);
  });

  it("leaves parked aircraft where they were reported", () => {
    const result = predict(
      {
        latitude: 51.47,
        longitude: -0.45,
        baroAltitude: null,
        velocity: 1,
        trueTrack: 90,
        verticalRate: null,
        onGround: true,
        timePosition: 1_000,
      },
      1_060_000,
    );
    assert.equal(result?.extrapolated, false);
    assert.equal(result?.lat, 51.47);
  });
});

describe("track membership", () => {
  it("records an entry, then coasts and departs when the aircraft leaves the feed", () => {
    const a = report({ icao24: "aaa111", callsign: "AAA1" });
    const b = report({ icao24: "bbb222", callsign: "BBB2", longitude: 0.1 });
    const first = mergeTracks({}, [a, b], 1_000, 100);
    assert.equal(first.events.filter((event) => event.kind === "entered").length, 2);

    const second = mergeTracks(first.aircraft, [a], 2_000, 130);
    assert.equal(second.aircraft.bbb222.status, "coasting");
    assert.ok(second.events.some((event) => event.kind === "lost" && event.icao24 === "bbb222"));

    const third = mergeTracks(second.aircraft, [a], 3_000, 200);
    assert.equal(third.aircraft.bbb222.status, "departed");
    assert.ok(third.events.some((event) => event.kind === "departed"));

    const back = mergeTracks(third.aircraft, [a, b], 4_000, 230);
    assert.equal(back.aircraft.bbb222.status, "live");
    assert.ok(back.events.some((event) => event.kind === "returned"));
  });

  it("keeps the last fix when a newer report omits coordinates", () => {
    const first = mergeTracks({}, [report()], 1_000, 10);
    const second = mergeTracks(
      first.aircraft,
      [report({ latitude: null, longitude: null, timePosition: 20, baroAltitude: null })],
      2_000,
      20,
    );
    assert.equal(second.aircraft.abc123.latitude, 51);
    assert.equal(second.aircraft.abc123.longitude, 0);
    assert.equal(second.aircraft.abc123.positionHeld, true);
    assert.equal(second.aircraft.abc123.status, "stale");
  });
});

describe("alerts", () => {
  it("fires once while an emergency squawk stays active", () => {
    const plane = tracked({ squawk: "7700", velocity: 50, icao24: "abc123" });
    const first = evaluateAlerts([plane], DEFAULT_RULES, {}, 5_000);
    assert.equal(first.events.length, 1);
    assert.match(first.events[0].message, /7700/);
    const second = evaluateAlerts([plane], DEFAULT_RULES, first.active, 6_000);
    assert.equal(second.events.length, 0);
    assert.equal(Object.keys(second.active).length, 1);
  });

  it("evaluates custom altitude and speed rules", () => {
    const highAndFast = tracked({
      icao24: "jet001",
      callsign: "JET1",
      baroAltitude: 12000,
      velocity: 280,
      onGround: false,
    });
    const customRules: AlertRule[] = [
      {
        id: "high-alt",
        name: "Above 10000m",
        enabled: true,
        kind: "altitude_above",
        meters: 10000,
        metersPerSec: null,
        box: null,
        locked: false,
      },
      {
        id: "high-speed",
        name: "Fast speed",
        enabled: true,
        kind: "speed_above",
        meters: null,
        metersPerSec: 250,
        box: null,
        locked: false,
      },
    ];
    const { active, events } = evaluateAlerts([highAndFast], customRules, {}, 10_000);
    assert.equal(events.length, 2);
    assert.ok(active["high-alt:jet001"]);
    assert.ok(active["high-speed:jet001"]);
  });
});

describe("geo helpers", () => {
  it("calculates accurate haversine distances", () => {
    // London (51.5, -0.1) to Paris (48.85, 2.35) is roughly 340 km
    const dist = haversine(51.5, -0.1, 48.85, 2.35);
    assert.ok(dist > 330_000 && dist < 350_000);
  });

  it("interpolates angles across the 360-degree boundary", () => {
    // Interpolating halfway between 350 and 10 should yield 0 (or 360)
    const mid = lerpAngle(350, 10, 0.5);
    assert.ok(Math.abs(mid) < 1e-4 || Math.abs(mid - 360) < 1e-4);
  });

  it("calculates bounding box overlap correctly", () => {
    const a = { lamin: 50, lomin: 0, lamax: 52, lomax: 2 };
    const b = { lamin: 51, lomin: 1, lamax: 53, lomax: 3 };
    const ratio = overlapRatio(a, b);
    // Intersection is [51, 52] x [1, 2] = 1 sq deg. Area of a is 4 sq deg -> ratio 0.25
    assert.ok(Math.abs(ratio - 0.25) < 0.01);
  });
});

describe("scene filtering and replay", () => {
  const defaultFilters: Filters = {
    query: "",
    phase: "all",
    minAlt: null,
    maxAlt: null,
    minSpeed: null,
    country: "all",
    emergenciesOnly: false,
    includeDeparted: false,
  };

  it("filters aircraft by flight phase and emergency squawk", () => {
    const airborne = tracked({ icao24: "air001", onGround: false, squawk: "1200" });
    const ground = tracked({ icao24: "gnd001", onGround: true, squawk: "7700" });
    const aircraftMap = { air001: airborne, gnd001: ground };

    const onlyAirborne = buildScene(aircraftMap, [], { on: false, playing: false, index: 0, speed: 1 }, { ...defaultFilters, phase: "airborne" }, null, 1_000);
    assert.equal(onlyAirborne.length, 1);
    assert.equal(onlyAirborne[0].aircraft.icao24, "air001");

    const onlyEmergency = buildScene(aircraftMap, [], { on: false, playing: false, index: 0, speed: 1 }, { ...defaultFilters, emergenciesOnly: true }, null, 1_000);
    assert.equal(onlyEmergency.length, 1);
    assert.equal(onlyEmergency[0].aircraft.icao24, "gnd001");
  });

  it("interpolates aircraft positions in replay mode between snapshots", () => {
    const snap1: Snapshot = {
      t: 10_000,
      upstreamTime: 10,
      reports: [report({ icao24: "rep001", latitude: 51.0, longitude: 0.0, baroAltitude: 1000 })],
    };
    const snap2: Snapshot = {
      t: 20_000,
      upstreamTime: 20,
      reports: [report({ icao24: "rep001", latitude: 52.0, longitude: 1.0, baroAltitude: 2000 })],
    };

    const scene = buildScene({}, [snap1, snap2], { on: true, playing: false, index: 0.5, speed: 1 }, defaultFilters, null, 15_000);
    assert.equal(scene.length, 1);
    assert.equal(scene[0].aircraft.icao24, "rep001");
    // Halfway between 51 and 52 -> 51.5
    assert.ok(Math.abs((scene[0].lat ?? 0) - 51.5) < 0.01);
    // Halfway between 0 and 1 -> 0.5
    assert.ok(Math.abs((scene[0].lon ?? 0) - 0.5) < 0.01);
    // Halfway between 1000 and 2000 -> 1500
    assert.ok(Math.abs((scene[0].alt ?? 0) - 1500) < 1);
  });
});

