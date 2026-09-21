import { AxiError } from "axi-sdk-js";
import { urlCandidates, type ResolvedConfig } from "./config.js";
import {
  candidateNotes,
  classifyTransport,
  scrub,
  urlSecrets,
  type CandidateNotes,
} from "./net.js";

const CONNECT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;

export class HaClient {
  private readonly urls: string[];
  private readonly secrets: string[];
  private readonly notes: CandidateNotes;
  /**
   * Index of the candidate that last answered; later requests inside the same
   * process try it first. The CLI is one process per invocation, so this only
   * avoids re-probing a dead candidate for the remaining calls of one command.
   */
  private preferred = 0;

  constructor(private readonly cfg: ResolvedConfig) {
    this.urls = urlCandidates(cfg);
    this.secrets = [cfg.token, ...urlSecrets(this.urls)];
    this.notes = candidateNotes(cfg);
  }

  async get(path: string): Promise<unknown> {
    return parseMaybeJson((await this.exchange("GET", path)).text);
  }

  /** Mutations are NEVER retried (contract #6). */
  async post(path: string, body: unknown): Promise<unknown> {
    return parseMaybeJson((await this.exchange("POST", path, body)).text);
  }

  /**
   * POST returning the verbatim response body: `/api/template` answers
   * text/plain, and JSON-parsing would corrupt renderings like `42`.
   */
  async postText(path: string, body: unknown): Promise<string> {
    return (await this.exchange("POST", path, body)).text;
  }

  /**
   * Try each configured candidate in order until one completes the request.
   * Fall back ONLY on transport-level failure (refused/unreachable/DNS/timeout).
   * An AxiError means an HTTP answer arrived (401/403/404/5xx/...) — proof the
   * instance is reachable — and is never retried against another candidate.
   */
  private async exchange(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    const order = this.candidateOrder();
    let lastError: unknown;
    for (let position = 0; position < order.length; position++) {
      const index = order[position];
      const url = this.urls[index];
      try {
        const out = await this.exchangeVia(url, method, path, body);
        this.preferred = index;
        this.notes.using(index, this.urls.length, url, position > 0);
        return out;
      } catch (e) {
        if (e instanceof AxiError) throw e;
        lastError = e;
        this.notes.failed(index, this.urls.length, url, this.transportDetail(e));
      }
    }
    throw this.networkError(lastError);
  }

  /** Natural order, rotated so the last known-good candidate goes first. */
  private candidateOrder(): number[] {
    const natural = this.urls.map((_, i) => i);
    if (this.preferred <= 0 || this.preferred >= natural.length) return natural;
    return [this.preferred, ...natural.filter((i) => i !== this.preferred)];
  }

  /** One candidate: request (plus a single 5xx retry for GETs), then status. */
  private async exchangeVia(
    url: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    let out = await this.attempt(url, method, path, body);
    if (method === "GET" && out.status >= 500) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, RETRY_DELAY_MS);
      await promise;
      out = await this.attempt(url, method, path, body);
    }
    if (out.status < 200 || out.status >= 300) throw this.httpError(out.status, out.text);
    return out;
  }

  private async attempt(
    url: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    // Connect phase gets a hard 5s budget; once headers arrive we swap in
    // the full request timeout for the remainder of the exchange.
    let timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      const text = await res.text();
      return { status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  private httpError(status: number, bodyText: string): AxiError {
    const detail = scrub(bodyText || `HTTP ${status}`, ...this.secrets);
    switch (status) {
      case 401:
        return new AxiError(`Authentication failed: ${detail}`, "AUTH_INVALID", [
          "check that the long-lived access token is valid",
          "run `ha-axi ping` to re-verify credentials",
        ]);
      case 404:
        return new AxiError(`Not found: ${detail}`, "NOT_FOUND", []);
      case 400:
      case 422:
        return new AxiError(`Validation failed: ${detail}`, "VALIDATION_ERROR", []);
      case 429:
        return new AxiError(`Rate limited by Home Assistant`, "RATE_LIMITED", [
          "retry after a short backoff",
        ]);
      default:
        if (status >= 500) {
          return new AxiError(`Home Assistant error (${status}): ${detail}`, "UPSTREAM_ERROR", [
            "check the Home Assistant server logs",
          ]);
        }
        return new AxiError(`Unexpected HTTP ${status}: ${detail}`, "UNKNOWN", []);
    }
  }

  /** Transport detail with the useless `fetch failed` dropped and secrets scrubbed. */
  private transportDetail(err: unknown): string {
    return scrub(classifyTransport(err).text, ...this.secrets);
  }

  private networkError(err: unknown): AxiError {
    // Node's fetch (undici) reports every transport failure with the literal
    // message "fetch failed" and puts the real reason on `err.cause`; the
    // shared classifier folds that in — AxiError has no `cause` field — so a
    // refused socket, DNS failure, missing route, and TLS problem stay
    // distinguishable. URIs with embedded credentials are scrubbed too.
    const { text, timedOut, tls } = classifyTransport(err);
    const msg = scrub(text, ...this.secrets);
    if (timedOut) {
      return new AxiError(`Connection to Home Assistant timed out: ${msg}`, "CONNECTION_FAILED", [
        "check that the instance is reachable",
        "raise the profile `timeout` for slow links",
      ]);
    }
    const suggestions = tls
      ? [
          "trust the certificate via NODE_EXTRA_CA_CERTS",
          "or set `insecure = true` on the profile",
        ]
      : ["check HASS_URL / profile url and that the instance is up"];
    return new AxiError(`Cannot reach Home Assistant: ${msg}`, "CONNECTION_FAILED", suggestions);
  }
}

// Re-exported for callers that imported it from this module before it moved.
export { scrub };

function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
