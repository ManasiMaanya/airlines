import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAlerts, DEFAULT_RULES } from "./alerts";
import { bboxArea, creditsForArea, project, validBBox } from "./geo";
import { parseState } from "./parse";
import { predict } from "./predict";
import { mergeTracks } from "./track";
import type { Aircraft, Report } from "./types";

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
});
