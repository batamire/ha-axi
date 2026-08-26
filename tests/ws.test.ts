import { describe, expect, it } from "vitest";
import { startFakeWs } from "./helpers.js";
import { wsCall } from "../dist/ws.js";
import type { ResolvedConfig } from "../dist/config.js";

function cfg(url: string): ResolvedConfig {
  return { url, token: "synthetic-token", profile: "test", timeoutMs: 2_000, insecure: false };
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
      const cmd = fake.received[1] as Record<string, unknown>;
      expect(cmd.id).toBe(2);
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
});
