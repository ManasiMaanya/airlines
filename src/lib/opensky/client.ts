import { parseStates } from "../parse";
import type { BBox, Report } from "../types";

const API_ROOT = "https://opensky-network.org/api";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const TOKEN_REFRESH_MARGIN_MS = 30_000;

export type OpenSkyCredentials = {
  clientId: string;
  clientSecret: string;
};

/** Filters for `GET /states/all`. Omit `bbox` to ask for the world feed. */
export type StatesQuery = {
  bbox?: BBox;
  /** Unix seconds. Anonymous callers ignore this. */
  time?: number;
  icao24?: string | string[];
  extended?: boolean;
};

export type StatesSuccess = {
  ok: true;
  time: number | null;
  aircraft: Report[];
  creditsRemaining: number | null;
};

export type StatesFailure = {
  ok: false;
  kind: "rate_limited" | "http" | "network" | "invalid";
  status: number | null;
  message: string;
  retryAfterSec: number | null;
  creditsRemaining: number | null;
};

export type StatesResult = StatesSuccess | StatesFailure;

export type OpenSkyClientOptions = {
  credentials?: OpenSkyCredentials | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

type Token = { value: string; exp: number };

/**
 * OpenSky REST client. It knows how to authenticate, classify rate limits, and
 * turn a state-vector payload into reports. Caching and recorded fallbacks stay
 * with the dashboard proxy.
 */
export class OpenSkyClient {
  private readonly credentials: OpenSkyCredentials | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private token: Token | null = null;

  constructor(options: OpenSkyClientOptions = {}) {
    this.credentials = options.credentials ?? null;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.now = options.now ?? Date.now;
  }

  async getStates(query: StatesQuery = {}): Promise<StatesResult> {
    const params = toSearch(query);
    const path = params.size > 0 ? `/states/all?${params}` : "/states/all";
    return this.requestStates(path, 0);
  }

  private async requestStates(path: string, attempt: number): Promise<StatesResult> {
    const headers = await this.authHeader();
    if (headers === null) {
      return failure("http", null, "OpenSky authentication failed before the state request.");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${API_ROOT}${path}`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      return failure("network", null, `OpenSky request failed (${reason}).`);
    }

    if (response.status === 401 && this.credentials && attempt === 0) {
      this.token = null;
      return this.requestStates(path, 1);
    }

    const creditsRemaining = headerNumber(response, "x-rate-limit-remaining");
    const retryAfterSec = headerNumber(response, "x-rate-limit-retry-after-seconds");

    if (response.status === 429) {
      return {
        ok: false,
        kind: "rate_limited",
        status: 429,
        message: `OpenSky rate limit reached. Retry in ${retryAfterSec ?? "a few"} seconds.`,
        retryAfterSec,
        creditsRemaining,
      };
    }

    if (!response.ok) {
      return failure("http", response.status, `OpenSky responded with HTTP ${response.status}.`, retryAfterSec, creditsRemaining);
    }

    let body: { time?: unknown; states?: unknown };
    try {
      body = (await response.json()) as { time?: unknown; states?: unknown };
    } catch {
      return failure("invalid", response.status, "OpenSky returned a body that is not JSON.", null, creditsRemaining);
    }

    if (!Array.isArray(body.states)) {
      return failure("invalid", response.status, "OpenSky omitted the state array.", null, creditsRemaining);
    }

    return {
      ok: true,
      time: typeof body.time === "number" ? body.time : null,
      aircraft: parseStates(body.states),
      creditsRemaining,
    };
  }

  /** Bearer header, or null when the token endpoint itself fails. */
  private async authHeader(): Promise<Record<string, string> | null> {
    if (!this.credentials) return {};
    const current = this.token;
    if (current && current.exp > this.now() + TOKEN_REFRESH_MARGIN_MS) {
      return { Authorization: `Bearer ${current.value}` };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 8_000)),
      });
    } catch {
      this.token = null;
      return null;
    }

    if (!response.ok) {
      this.token = null;
      return null;
    }

    let json: { access_token?: unknown; expires_in?: unknown };
    try {
      json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    } catch {
      this.token = null;
      return null;
    }

    if (typeof json.access_token !== "string" || json.access_token.length === 0) {
      this.token = null;
      return null;
    }

    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 1800;
    this.token = { value: json.access_token, exp: this.now() + expiresIn * 1000 };
    return { Authorization: `Bearer ${json.access_token}` };
  }
}

const clients = globalThis as typeof globalThis & {
  __openskyClient?: { key: string; client: OpenSkyClient };
};

/** One client per process, rebuilt when the configured client id changes. */
export function openSkyClientFromEnv(env: NodeJS.ProcessEnv = process.env): OpenSkyClient {
  const id = env.OPENSKY_CLIENT_ID;
  const secret = env.OPENSKY_CLIENT_SECRET;
  const credentials = id && secret ? { clientId: id, clientSecret: secret } : null;
  const key = credentials ? credentials.clientId : "anonymous";
  if (!clients.__openskyClient || clients.__openskyClient.key !== key) {
    clients.__openskyClient = { key, client: new OpenSkyClient({ credentials }) };
  }
  return clients.__openskyClient.client;
}

function toSearch(query: StatesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.bbox) {
    params.set("lamin", String(query.bbox.lamin));
    params.set("lomin", String(query.bbox.lomin));
    params.set("lamax", String(query.bbox.lamax));
    params.set("lomax", String(query.bbox.lomax));
  }
  if (query.time != null) params.set("time", String(Math.trunc(query.time)));
  if (query.extended) params.set("extended", "1");
  const ids = query.icao24 == null ? [] : Array.isArray(query.icao24) ? query.icao24 : [query.icao24];
  for (const id of ids) params.append("icao24", id.trim().toLowerCase());
  return params;
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers.get(name);
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failure(
  kind: StatesFailure["kind"],
  status: number | null,
  message: string,
  retryAfterSec: number | null = null,
  creditsRemaining: number | null = null,
): StatesFailure {
  return { ok: false, kind, status, message, retryAfterSec, creditsRemaining };
}
