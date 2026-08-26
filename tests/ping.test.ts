import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart } from "./helpers.js";

describe("ping", () => {
  it("emits TOON {ok, profile, version, latency_ms} on success", async () => {
    const fake = await startFakeHa({
      "GET /api/": { message: "API running." },
      "GET /api/config": { version: "2026.8.0", location_name: "Example Home" },
    });
    try {
      const res = await runCli(["ping"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.ok).toBe(true);
      expect(doc.profile).toBe("default");
      expect(doc.version).toBe("2026.8.0");
      expect(typeof doc.latency_ms).toBe("number");
      // contract: every command closes with a help suggestion where one exists
      expect(res.stdout).toContain("help[1]:");
    } finally {
      await fake.close();
    }
  });

  it("maps HTTP 401 to AUTH_INVALID with nonzero exit", async () => {
    const fake = await startFakeHa({
      "GET /api/": { status: 401, json: { message: "Unauthorized" } },
    });
    try {
      const res = await runCli(["ping"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).not.toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.code).toBe("AUTH_INVALID");
      expect(String(doc.error)).not.toContain("synthetic-token");
    } finally {
      await fake.close();
    }
  });

  it("maps a refused connection to CONNECTION_FAILED", async () => {
    // Grab an ephemeral port and free it: nothing listens there now.
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const deadPort = (srv.address() as { port: number }).port;
    await new Promise<void>((resolve) => srv.close(() => resolve()));

    const res = await runCli(["ping"], {
      env: { HASS_URL: `http://127.0.0.1:${deadPort}`, HASS_TOKEN: "synthetic-token" },
    });
    expect(res.status).not.toBe(0);
    const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
    expect(doc.code).toBe("CONNECTION_FAILED");
  });

  it("rejects an unknown subcommand with a validation error", async () => {
    const res = await runCli(["statistics", "bogus"], {
      env: { HASS_URL: "https://hass.example", HASS_TOKEN: "synthetic-token" },
    });
    expect(res.status).toBe(2);
    expect(res.stdout).toContain("Unknown statistics command");
  });
});
