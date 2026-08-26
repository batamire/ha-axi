import { AxiError } from "axi-sdk-js";
import type { ResolvedConfig } from "./config.js";

const CONNECT_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;

export class HaClient {
  constructor(private readonly cfg: ResolvedConfig) {}

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

  private async exchange(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    try {
      let out = await this.attempt(method, path, body);
      if (method === "GET" && out.status >= 500) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, RETRY_DELAY_MS);
        await promise;
        out = await this.attempt(method, path, body);
      }
      if (out.status < 200 || out.status >= 300) throw this.httpError(out.status, out.text);
      return out;
    } catch (e) {
      if (e instanceof AxiError) throw e;
      throw this.networkError(e as Error);
    }
  }

  private async attempt(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    // Connect phase gets a hard 5s budget; once headers arrive we swap in
    // the full request timeout for the remainder of the exchange.
    let timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.cfg.url}${path}`, {
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
    const detail = scrub(bodyText || `HTTP ${status}`, this.cfg.token);
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

  private networkError(err: Error): AxiError {
    const msg = scrub(err.message || "connection failed", this.cfg.token);
    const timedOut = err.name === "AbortError" || /abort/i.test(msg);
    if (timedOut) {
      return new AxiError(`Connection to Home Assistant timed out: ${msg}`, "CONNECTION_FAILED", [
        "check that the instance is reachable",
        "raise the profile `timeout` for slow links",
      ]);
    }
    const tls = /certificate|self-signed|unable to verify|TLS|SSL/i.test(msg);
    const suggestions = tls
      ? [
          "trust the certificate via NODE_EXTRA_CA_CERTS",
          "or set `insecure = true` on the profile",
        ]
      : ["check HASS_URL / profile url and that the instance is up"];
    return new AxiError(`Cannot reach Home Assistant: ${msg}`, "CONNECTION_FAILED", suggestions);
  }
}


function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Tokens never appear anywhere in output — scrub them from any message. */
export function scrub(message: string, ...secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s) out = out.split(s).join("[redacted]");
  }
  return out;
}
