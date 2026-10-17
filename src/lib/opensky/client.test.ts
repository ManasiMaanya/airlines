import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenSkyClient, type OpenSkyClientOptions } from "./client";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function client(fetchImpl: OpenSkyClientOptions["fetch"], extra: OpenSkyClientOptions = {}) {
  return new OpenSkyClient({ fetch: fetchImpl, timeoutMs: 1000, ...extra });
}

describe("OpenSkyClient", () => {
  it("parses a bounding-box state response and the credit header", async () => {
    const calls: string[] = [];
    const api = client(async (input) => {
      calls.push(String(input));
      return json(
        {
          time: 1_700_000_000,
          states: [["abc123", "BAW1  ", "United Kingdom", 1_700_000_000, 1_700_000_000, -0.4, 51.5, 1000, false, 200, 90, 0, null, 1100, "1234", false, 0]],
        },
        200,
        { "x-rate-limit-remaining": "399" },
      );
    });

    const result = await api.getStates({
      bbox: { lamin: 51.2, lomin: -0.55, lamax: 51.75, lomax: 0.25 },
      icao24: ["ABC123", "def456"],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.time, 1_700_000_000);
    assert.equal(result.creditsRemaining, 399);
    assert.equal(result.aircraft.length, 1);
    assert.equal(result.aircraft[0].callsign, "BAW1");
    assert.equal(result.aircraft[0].latitude, 51.5);
    const url = new URL(calls[0]);
    assert.equal(url.pathname, "/api/states/all");
    assert.equal(url.searchParams.get("lamin"), "51.2");
    assert.deepEqual(url.searchParams.getAll("icao24"), ["abc123", "def456"]);
  });

  it("reports a rate limit without throwing", async () => {
    const api = client(async () => json({ message: "slow down" }, 429, { "x-rate-limit-retry-after-seconds": "30" }));
    const result = await api.getStates();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "rate_limited");
    assert.equal(result.retryAfterSec, 30);
    assert.match(result.message, /30/);
  });

  it("treats a missing state array as an incomplete payload", async () => {
    const api = client(async () => json({ time: 10, states: null }));
    const result = await api.getStates();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "invalid");
  });

  it("reuses a token, then refreshes it after a 401", async () => {
    const calls: string[] = [];
    let states = 0;
    const api = client(
      async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url === TOKEN_URL) {
          const token = calls.filter((item) => item === TOKEN_URL).length === 1 ? "one" : "two";
          return json({ access_token: token, expires_in: 1800 });
        }
        states += 1;
        const auth = new Headers(init?.headers).get("authorization");
        if (states === 2) {
          assert.equal(auth, "Bearer one");
          return json({}, 401);
        }
        return json({ time: states, states: [] }, 200, { "x-rate-limit-remaining": "10" });
      },
      { credentials: { clientId: "id", clientSecret: "secret" } },
    );

    const first = await api.getStates();
    const second = await api.getStates();
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.deepEqual(
      calls.map((url) => (url === TOKEN_URL ? "token" : "states")),
      ["token", "states", "states", "token", "states"],
    );
  });

  it("does not call the state endpoint when the token request fails", async () => {
    const calls: string[] = [];
    const api = client(async (input) => {
      calls.push(String(input));
      return json({}, 401);
    }, { credentials: { clientId: "id", clientSecret: "secret" } });

    const result = await api.getStates();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "http");
    assert.deepEqual(calls, [TOKEN_URL]);
  });
});
