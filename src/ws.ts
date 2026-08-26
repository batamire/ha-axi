import { AxiError } from "axi-sdk-js";
import type { ResolvedConfig } from "./config.js";

type WsMessage = {
  id?: number;
  type: string;
  success?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Stateless one-shot WS bridge (contract #11/#15 scope): connect, auth hello,
 * ONE request/response pair by id, close. No subscriptions, no streaming.
 * Registries + statistics reads only.
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

  const wsUrl = `${cfg.url.replace(/^http/, "ws")}/api/websocket`;
  const ws = new WebSocket(wsUrl);
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
    finish(new AxiError(`WS bridge timed out calling '${type}'`, "CONNECTION_FAILED", []));
  }, cfg.timeoutMs);

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
        send({ id: ++id, type: "auth", access_token: cfg.token });
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
                `WS command '${type}' failed: ${err.message ?? JSON.stringify(err)}`,
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
      finish(new AxiError(`WS send failed: ${(e as Error).message}`, "CONNECTION_FAILED", []));
    }
  }

  ws.addEventListener("error", () => {
    finish(new AxiError("Cannot reach Home Assistant over WebSocket", "CONNECTION_FAILED", []));
  });

  ws.addEventListener("close", () => {
    if (!settled) {
      finish(new AxiError("WebSocket closed before a result arrived", "CONNECTION_FAILED", []));
    }
  });

  return promise;
}
