import { describe, expect, it } from "vitest";
import { HaClient } from "../dist/ha.js";
import type { ResolvedConfig } from "../dist/config.js";
import { startFakeHa } from "./helpers.js";

function cfg(url: string): ResolvedConfig {
  return { url, token: "synthetic-token", profile: "test", timeoutMs: 5_000, insecure: false };
}

describe("REST client retry policy", () => {
  it("retries a GET once after a 5xx and succeeds on the second attempt", async () => {
    let calls = 0;
    const fake = await startFakeHa({
      "GET /api/config": () => {
        calls += 1;
        if (calls === 1) return { status: 503, json: { message: "starting up" } };
        return { version: "2026.8.0" };
      },
    });
    try {
      const client = new HaClient(cfg(fake.url));
      const out = (await client.get("/api/config")) as Record<string, unknown>;
      expect(out.version).toBe("2026.8.0");
      expect(calls).toBe(2);
    } finally {
      await fake.close();
    }
  });

  it("gives UPSTREAM_ERROR after exactly one retry when 5xx persists", async () => {
    let calls = 0;
    const fake = await startFakeHa({
      "GET /api/": () => {
        calls += 1;
        return { status: 500, json: { message: "boom" } };
      },
    });
    try {
      const client = new HaClient(cfg(fake.url));
      await expect(client.get("/api/")).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(calls).toBe(2);
    } finally {
      await fake.close();
    }
  });

  it("never retries a POST — one hit only", async () => {
    let calls = 0;
    const fake = await startFakeHa({
      "POST /api/template": () => {
        calls += 1;
        return { status: 500, json: { message: "boom" } };
      },
    });
    try {
      const client = new HaClient(cfg(fake.url));
      await expect(
        client.post("/api/template", { template: "{{ states('light.kitchen') }}" }),
      ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(calls).toBe(1);
    } finally {
      await fake.close();
    }
  });
});
