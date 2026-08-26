// Shared CLI-seam harness: spawn the built binary against a fake Home
// Assistant HTTP server (+ minimal one-shot WS server). Used identically by
// every *.test.ts in this directory. All fixtures are synthetic.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { mkdir, chmod, writeFile } from "node:fs/promises";

export const BIN = "./dist/bin/ha-axi.js";

// ---------- fake HA HTTP server ----------

export type RouteCtx = { method: string; body?: unknown };
/** Return a plain value (=200 JSON) or {status?, json?}. */
export type RouteHandler = (ctx: RouteCtx) => unknown;

export type Hit = { method: string; path: string; body?: unknown };

export type FakeHa = {
  url: string;
  hits: Hit[];
  hitCount(method: string, path: string): number;
  close(): Promise<void>;
};

export async function startFakeHa(
  routes: Record<string, RouteHandler>,
  opts: { ws?: WsResultFor } = {},
): Promise<FakeHa> {
  const fake: FakeHa = {
    url: "",
    hits: [],
    hitCount(method, path) {
      return this.hits.filter((h) => h.method === method && h.path === path).length;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  function readBody(req: IncomingMessage): Promise<unknown> {
    if (req.method === "GET") return Promise.resolve(undefined);
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    return new Promise((resolve) => {
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(text ? JSON.parse(text) : undefined);
        } catch {
          resolve(text);
        }
      });
      req.on("error", () => resolve(undefined));
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    fake.hits.push({ method: req.method ?? "?", path: req.url ?? "?", body });
    const key = `${req.method} ${req.url}`;
    const route = routes[key] ?? routes[req.url ?? ""];
    res.setHeader("Content-Type", "application/json");
    if (!route) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "Not found: no such fixture route" }));
      return;
    }
    const out =
      typeof route === "function" ? await route({ method: req.method ?? "?", body }) : route;
    const isEnvelope =
      typeof out === "object" && out !== null && ("json" in out || "status" in out);
    const { status = 200, json } = isEnvelope
      ? (out as { status?: number; json?: unknown })
      : { json: out };
    res.statusCode = status;
    res.end(JSON.stringify(json ?? {}));
  }
  if (opts.ws) {
    attachOneShotWs(server, opts.ws, new Set<Socket>());
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  fake.url = `http://127.0.0.1:${addr.port}`;
  return fake;
}

/** Count recorded hits for assertions about exactly-once delivery. */
export function hitCount(fake: FakeHa, method: string, path: string): number {
  return fake.hits.filter((h) => h.method === method && h.path === path).length;
}

// ---------- minimal one-shot WS server ----------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type FakeWs = { url: string; received: unknown[]; close(): Promise<void> };

export type WsResultFor = (msg: { type: string; payload: Record<string, unknown> }) => unknown;

function frame(payload: string): Buffer {
  const data = Buffer.from(payload, "utf-8");
  if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length);
  return Buffer.concat([Buffer.from([0x81, 126]), len, data]);
}

/**
 * Attach a one-shot WS endpoint onto an existing HTTP server: sends
 * `auth_required`, accepts an auth frame, replies `auth_ok`, then answers every
 * request frame with `{id, type:"result", success:true, result}` from
 * `resultFor(msg)`. Used directly by startFakeWs and, via `opts.ws`, to serve
 * registry reads on the same port as the fake REST API.
 */
function attachOneShotWs(
  server: Server,
  resultFor: WsResultFor,
  sockets: Set<Socket>,
  received?: unknown[],
): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(frame(JSON.stringify({ type: "auth_required" })));

    let buffer = Buffer.alloc(0);
    let authenticated = false;
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Minimal single-frame parse: masked client frames, small payloads.
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const lenByte = buffer[1] & 0x7f;
        if (opcode === 0x8) {
          // close frame: echo it back so the client's closing handshake
          // completes and its process can exit
          const maskStart = 2;
          if (buffer.length < maskStart + 4 + lenByte) break;
          const payload = buffer.subarray(maskStart + 4, maskStart + 4 + lenByte);
          buffer = buffer.subarray(maskStart + 4 + lenByte);
          socket.end(Buffer.concat([Buffer.from([0x88, lenByte]), payload]));
          break;
        }
        if (opcode !== 0x1) {
          buffer = Buffer.alloc(0); // not a text frame — drop and resync
          break;
        }
        const maskStart = 2;
        if (buffer.length < maskStart + 4 + lenByte) break;
        const mask = buffer.subarray(maskStart, maskStart + 4);
        const payloadStart = maskStart + 4;
        const payload = Buffer.from(
          buffer.subarray(payloadStart, payloadStart + lenByte).map((b, i) => b ^ mask[i % 4]),
        );
        buffer = buffer.subarray(payloadStart + lenByte);
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(payload.toString("utf-8")) as Record<string, unknown>;
        } catch {
          continue;
        }
        received?.push(msg);
        if (!authenticated && msg.type === "auth") {
          authenticated = true;
          socket.write(frame(JSON.stringify({ type: "auth_ok" })));
          continue;
        }
        const result = resultFor({
          type: String(msg.type),
          payload: msg as Record<string, unknown>,
        });
        socket.write(frame(JSON.stringify({ id: msg.id, type: "result", success: true, result })));
      }
    });
  });
}

/**
 * Standalone one-shot WS endpoint (same protocol as attachOneShotWs) for
 * tests that exercise the bridge directly.
 */
export async function startFakeWs(result: unknown): Promise<FakeWs> {
  const received: unknown[] = [];
  const server: Server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 426;
    res.end();
  });
  const sockets = new Set<Socket>();
  attachOneShotWs(server, () => result, sockets, received);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;

  const fake: FakeWs = {
    url: `http://127.0.0.1:${addr.port}`,
    received,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return fake;
}

// ---------- CLI runner ----------

export type RunCliOpts = {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  stdin?: string;
};

export type RunCliResult = { status: number; stdout: string; stderr: string };

/**
 * Run the built binary with optional env overrides (undefined deletes a var).
 * Async spawn — the caller's event loop must stay free so the in-process fake
 * server can answer the child.
 */
export function runCli(args: string[], opts: RunCliOpts = {}): Promise<RunCliResult> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.XDG_CONFIG_HOME; // keep resolution anchored to the (temp) HOME
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  if (opts.homeDir) env.HOME = opts.homeDir;

  const child = spawn("node", [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => stdout.push(c));
  child.stderr.on("data", (c: Buffer) => stderr.push(c));
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
  child.stdin.end();

  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      });
    });
  });
}

/** Strip a trailing help block so the leading TOON document can be decoded. */
export function toonPart(stdout: string): string {
  return stdout.split("\nhelp[")[0];
}

/** Write a config.toml under a temp HOME and set its mode. */
export async function writeConfig(
  homeDir: string,
  toml: string,
  mode: number = 0o600,
): Promise<string> {
  const dir = join(homeDir, ".config", "ha-axi");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "config.toml");
  await writeFile(path, toml);
  await chmod(path, mode);
  return path;
}
