import { AxiError } from "axi-sdk-js";
import { urlCandidates, type ResolvedConfig } from "./config.js";
import {
  candidateNotes,
  classifyTransport,
  foldDetail,
  looksLikeTlsFailure,
  scrub,
  urlSecrets,
} from "./net.js";

type WsMessage = {
  id?: number;
  type: string;
  success?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
};

/** Close codes worth naming; 1006 is what Node reports for a refused socket. */
const WS_CLOSE_LABEL: Record<number, string> = {
  1000: "normal closure",
  1001: "going away",
  1002: "protocol error",
  1003: "unsupported data",
  1006: "abnormal closure (no close frame)",
  1008: "policy violation",
  1009: "message too big",
  1011: "internal error",
  1015: "TLS handshake failure",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Stateless one-shot WS bridge (contract #11/#15 scope): connect, auth hello,
 * ONE request/response pair by id, close. No subscriptions, no streaming.
 * Registries + statistics reads only.
 *
 * Candidates are tried in order and fall back ONLY on transport-level failure
 * (`CONNECTION_FAILED`): `auth_invalid` or a command error is an answer from
 * Home Assistant and is never retried against another candidate.
 *
 * Prefers Node's native WebSocket global (Node >=22).
 */
export async function wsCall(
  cfg: ResolvedConfig,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  if (typeof globalThis.WebSocket !== "function") {
    throw new AxiError(
      "WebSocket bridge needs Node >=22 (native WebSocket global missing)",
      "UNKNOWN",
      ["upgrade Node to >=22"],
    );
  }

  const urls = urlCandidates(cfg);
  const notes = candidateNotes(cfg);
  let lastError: AxiError | undefined;
  for (let i = 0; i < urls.length; i++) {
    try {
      const out = await wsCallOnce(urls[i], cfg, type, payload);
      notes.using(i, urls.length, urls[i], i > 0);
      return out;
    } catch (e) {
      if (!(e instanceof AxiError) || e.code !== "CONNECTION_FAILED") throw e;
      lastError = e;
      notes.failed(i, urls.length, urls[i], e.message);
    }
  }
  throw lastError ??
    new AxiError("Cannot reach Home Assistant over WebSocket", "CONNECTION_FAILED", []);
}

async function wsCallOnce(
  url: string,
  cfg: ResolvedConfig,
  type: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const secrets = [cfg.token, ...urlSecrets([url])];

  const transportError = (detail: string): AxiError => {
    const text = scrub(detail || "connection failed", ...secrets);
    const suggestions = looksLikeTlsFailure(text)
      ? [
          "trust the certificate via NODE_EXTRA_CA_CERTS",
          "or set `insecure = true` on the profile",
        ]
      : ["check HASS_URL / profile url and that the instance is up"];
    return new AxiError(
      `Cannot reach Home Assistant over WebSocket: ${text}`,
      "CONNECTION_FAILED",
      suggestions,
    );
  };

  let ws: WebSocket;
  try {
    ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
  } catch (e) {
    throw transportError(classifyTransport(e).text);
  }

  const { promise, resolve, reject } = Promise.withResolvers<unknown>();

  let id = 0;
  let settled = false;

  const finish = (err: AxiError | null, value?: unknown): void => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    try {
      ws.close();
    } catch {
      // already closed
    }
    if (err) reject(err);
    else resolve(value);
  };

  // Hard deadline covering the whole one-shot exchange.
  const deadline = setTimeout(() => {
    finish(
      new AxiError(`WS bridge timed out calling '${type}'`, "CONNECTION_FAILED", [
        "check that the instance is reachable",
        "raise the profile `timeout` for slow links",
      ]),
    );
  }, cfg.timeoutMs);

  // Node's native WebSocket usually reports only an opaque TypeError here
  // (empty message, no cause); the close event that follows carries the code.
  // When the runtime does expose detail, finish immediately with it.
  let errorDetail = "";
  ws.addEventListener("error", (ev: Event) => {
    errorDetail = describeErrorEvent(ev as ErrorEventLike);
    if (errorDetail) finish(transportError(errorDetail));
  });

  ws.addEventListener("close", (ev: Event) => {
    if (settled) return;
    const closeDetail = describeClose(ev as CloseEventLike);
    finish(transportError(foldDetail(errorDetail, closeDetail)));
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    let msg: WsMessage;
    try {
      const parsed: unknown = JSON.parse(String(ev.data));
      if (!isRecord(parsed)) return;
      msg = parsed as WsMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "auth_required":
        send({ type: "auth", access_token: cfg.token });
        break;
      case "auth_invalid":
        finish(
          new AxiError("Authentication failed (WS)", "AUTH_INVALID", [
            "check that the long-lived access token is valid",
          ]),
        );
        break;
      case "auth_ok":
        send({ id: ++id, type, ...payload });
        break;
      default:
        if (msg.id === id && msg.type === "result") {
          if (msg.success) finish(null, msg.result);
          else {
            const err = msg.error ?? {};
            finish(
              new AxiError(
                `WS command '${type}' failed: ${scrub(
                  err.message ?? JSON.stringify(err),
                  ...secrets,
                )}`,
                err.code === "not_found" ? "NOT_FOUND" : "UPSTREAM_ERROR",
                [],
              ),
            );
          }
        }
    }
  });

  function send(obj: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      finish(transportError(`send failed: ${classifyTransport(e).text}`));
    }
  }

  return promise;
}

/** Structural shapes: the DOM lib is not loaded, only undici's runtime events. */
type ErrorEventLike = { message?: unknown; error?: unknown };
type CloseEventLike = { code?: unknown; reason?: unknown };

/** Detail from an error event, or "" when the runtime exposes nothing usable. */
function describeErrorEvent(ev: ErrorEventLike): string {
  const parts: string[] = [];
  const message = typeof ev.message === "string" ? ev.message.trim() : "";
  if (message) parts.push(message);
  if (ev.error) {
    const text = classifyTransport(ev.error).text;
    if (text !== "connection failed") parts.push(text);
  }
  return [...new Set(parts)].join(": ");
}

function describeClose(ev: CloseEventLike): string {
  const code = typeof ev.code === "number" ? ev.code : 1006;
  const label = WS_CLOSE_LABEL[code] ? `: ${WS_CLOSE_LABEL[code]}` : "";
  const reason = typeof ev.reason === "string" ? ev.reason.trim() : "";
  return `connection closed (code ${code}${label})${reason ? ` - ${reason}` : ""}`;
}
