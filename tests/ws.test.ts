import { describe, expect, it, vi } from "vitest";
import type { AxiError } from "axi-sdk-js";
import { startFakeWs, unusedPort } from "./helpers.js";
import { wsCall } from "../dist/ws.js";
import type { ResolvedConfig } from "../dist/config.js";

function cfg(url: string): ResolvedConfig {
  return {
    url,
    urls: [url],
    token: "synthetic-token",
    profile: "test",
    timeoutMs: 2_000,
    insecure: false,
    verbose: false,
  };
}

function cfgUrls(urls: string[]): ResolvedConfig {
  return { ...cfg(urls[0]), urls };
}

function captureStderr(): { text(): string; restore(): void } {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return {
    text: () => spy.mock.calls.map((call) => String(call[0])).join(""),
    restore: () => spy.mockRestore(),
  };
}

describe("stateless WS bridge", () => {
  it("authenticates, answers ONE request by id, and closes", async () => {
    const fake = await startFakeWs({ name: "kitchen", floor_id: null });
    try {
      const out = await wsCall(cfg(fake.url), "config/area_registry/list", {});
      expect(out).toEqual({ name: "kitchen", floor_id: null });
      // one auth + one command — nothing else was sent
      expect(fake.received).toHaveLength(2);
      expect((fake.received[0] as Record<string, unknown>).type).toBe("auth");
      // auth frame has no id per HA spec; the single command is id 1
      expect((fake.received[0] as Record<string, unknown>).id).toBeUndefined();
      const cmd = fake.received[1] as Record<string, unknown>;
      expect(cmd.id).toBe(1);
      expect(cmd.type).toBe("config/area_registry/list");
    } finally {
      await fake.close();
    }
  });

  it("maps an unreachable WS endpoint to CONNECTION_FAILED", async () => {
    await expect(
      wsCall(cfg("http://127.0.0.1:9"), "config/area_registry/list", {}),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });

  it("surfaces transport detail instead of the old fixed message", async () => {
    const dead = await unusedPort();
    const err = (await wsCall(cfg(`http://127.0.0.1:${dead}`), "config/area_registry/list", {}).catch(
      (e: unknown) => e,
    )) as AxiError;
    expect(err).toMatchObject({ code: "CONNECTION_FAILED" });
    expect(err.message).toMatch(/over WebSocket/i);
    expect(err.message).not.toBe("Cannot reach Home Assistant over WebSocket");
    // The detail the runtime exposes differs by Node version: Node 24 reports
    // the socket failure on the close event (code 1006, empty reason), while
    // Node 22 surfaces undici's own "Received network error or non-101 status
    // code." on the error event instead. Either is real transport detail; the
    // regression this guards is the bare fixed message, which matches none of
    // these tokens.
    expect(err.message).toMatch(/1006|closed|refused|ECONNREFUSED|network error|non-101/i);
  });

  it("falls back to the next candidate on a transport-level failure", async () => {
    const dead = await unusedPort();
    const fake = await startFakeWs({ name: "kitchen", floor_id: null });
    const stderr = captureStderr();
    try {
      const out = await wsCall(
        cfgUrls([`http://127.0.0.1:${dead}`, fake.url]),
        "config/area_registry/list",
        {},
      );
      expect(out).toEqual({ name: "kitchen", floor_id: null });
      expect(stderr.text()).toContain("candidate 1/2");
      expect(stderr.text()).toContain("using candidate 2/2");
      expect(fake.received).toHaveLength(2);
    } finally {
      stderr.restore();
      await fake.close();
    }
  });

  it("does not fall back when a candidate rejects auth (auth_invalid)", async () => {
    const bad = await startFakeWs({}, { authInvalid: true });
    const good = await startFakeWs({ name: "kitchen" });
    try {
      await expect(
        wsCall(cfgUrls([bad.url, good.url]), "config/area_registry/list", {}),
      ).rejects.toMatchObject({ code: "AUTH_INVALID" });
      expect(good.received).toHaveLength(0);
    } finally {
      await bad.close();
      await good.close();
    }
  });
});
