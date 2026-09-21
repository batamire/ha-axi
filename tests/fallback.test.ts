// Ordered candidate URLs: a profile may list a LAN address and a Tailscale
// address for the same instance. Candidates are tried in order, and the tool
// falls back ONLY on transport-level failure — an HTTP answer (401/404/5xx)
// proves the instance is reachable and must never be retried elsewhere.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import {
  runCli,
  startFakeHa,
  startHangingServer,
  toonPart,
  unusedPort,
  writeConfig,
} from "./helpers.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ha-axi-fallback-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const ENV_CLEAN = { HASS_URL: undefined, HASS_URLS: undefined, HASS_TOKEN: undefined };

const PING_ROUTES = {
  "GET /api/": { message: "API running." },
  "GET /api/config": { version: "2026.8.0" },
};

describe("ordered candidate URLs", () => {
  it("uses the first candidate and never touches the others", async () => {
    const primary = await startFakeHa(PING_ROUTES);
    const secondary = await startFakeHa({
      "GET /api/": { message: "API running." },
      "GET /api/config": { version: "0000.0.0" },
    });
    try {
      const res = await runCli(["ping"], {
        env: { ...ENV_CLEAN, HASS_URLS: `${primary.url},${secondary.url}`, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.version).toBe("2026.8.0");
      // stdout keeps the ping TOON contract exactly
      expect(Object.keys(doc).sort()).toEqual(["latency_ms", "ok", "profile", "version"]);
      expect(secondary.hits).toHaveLength(0);
      expect(primary.hitCount("GET", "/api/")).toBe(1);
    } finally {
      await primary.close();
      await secondary.close();
    }
  });

  it("falls back on a transport failure and reports which candidate answered", async () => {
    const dead = await unusedPort();
    const live = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping"], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `http://127.0.0.1:${dead},${live.url}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.ok).toBe(true);
      expect(live.hits.length).toBeGreaterThan(0);
      expect(res.stderr).toContain("candidate 1/2");
      expect(res.stderr).toContain("unreachable");
      expect(res.stderr).toContain(`using candidate 2/2: ${live.url} (fallback)`);
    } finally {
      await live.close();
    }
  });

  it("supports three ordered candidates declared in a profile", async () => {
    const deadA = await unusedPort();
    const deadB = await unusedPort();
    const live = await startFakeHa(PING_ROUTES);
    try {
      await writeConfig(
        home,
        `[profiles.tri]\nurls = ["http://127.0.0.1:${deadA}", "http://127.0.0.1:${deadB}", "${live.url}"]\ntoken = "profile-token"\n`,
      );
      const res = await runCli(["ping", "-p", "tri"], { env: ENV_CLEAN, homeDir: home });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.ok).toBe(true);
      expect(res.stderr).toContain("candidate 1/3");
      expect(res.stderr).toContain("candidate 2/3");
      expect(res.stderr).toContain("using candidate 3/3");
    } finally {
      await live.close();
    }
  });

  it("does not fall back when the first candidate answers 401", async () => {
    const first = await startFakeHa({
      "GET /api/": { status: 401, json: { message: "Unauthorized" } },
    });
    const second = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping"], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `${first.url},${second.url}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).not.toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.code).toBe("AUTH_INVALID");
      expect(second.hits).toHaveLength(0);
      expect(res.stderr).not.toContain("using candidate");
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("does not fall back on a 5xx: the retry stays local to the candidate", async () => {
    const first = await startFakeHa({
      "GET /api/": { status: 500, json: { message: "boom" } },
    });
    const second = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping"], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `${first.url},${second.url}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).not.toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.code).toBe("UPSTREAM_ERROR");
      expect(first.hitCount("GET", "/api/")).toBe(2);
      expect(second.hits).toHaveLength(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("falls back when a candidate times out before sending headers", { timeout: 20_000 }, async () => {
    const hanging = await startHangingServer();
    const live = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping"], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `${hanging.url},${live.url}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.ok).toBe(true);
      expect(res.stderr).toContain("candidate 1/2");
      expect(res.stderr).toContain("using candidate 2/2");
    } finally {
      await hanging.close();
      await live.close();
    }
  });

  it("leaves a legacy single-url profile byte-identical on stderr", async () => {
    const live = await startFakeHa(PING_ROUTES);
    try {
      await writeConfig(home, `[profiles.solo]\nurl = "${live.url}"\ntoken = "profile-token"\n`);
      const res = await runCli(["ping", "-p", "solo"], { env: ENV_CLEAN, homeDir: home });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.ok).toBe(true);
    } finally {
      await live.close();
    }
  });

  it("lets --url win over HASS_URLS", async () => {
    const dead = await unusedPort();
    const live = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping", "--url", live.url], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `http://127.0.0.1:${dead}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expect(live.hits.length).toBeGreaterThan(0);
    } finally {
      await live.close();
    }
  });

  it("traces the chosen candidate with --verbose without changing stdout", async () => {
    const live = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping", "--verbose"], {
        env: { ...ENV_CLEAN, HASS_URL: live.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("using candidate 1/1");
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(Object.keys(doc).sort()).toEqual(["latency_ms", "ok", "profile", "version"]);
    } finally {
      await live.close();
    }
  });

  it("rejects a malformed profile `urls` value", async () => {
    await writeConfig(home, `[profiles.bad]\nurls = "https://hass.example"\ntoken = "t"\n`);
    const res = await runCli(["ping", "-p", "bad"], { env: ENV_CLEAN, homeDir: home });
    expect(res.status).not.toBe(0);
    const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
    expect(doc.code).toBe("VALIDATION_ERROR");
    expect(String(doc.error)).toContain("array of URL strings");
  });

  it("never leaks credentials embedded in a candidate URL", async () => {
    const dead = await unusedPort();
    const live = await startFakeHa(PING_ROUTES);
    try {
      const res = await runCli(["ping"], {
        env: {
          ...ENV_CLEAN,
          HASS_URLS: `http://user:synthetic-token@127.0.0.1:${dead},${live.url}`,
          HASS_TOKEN: "synthetic-token",
        },
      });
      expect(res.status).toBe(0);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("synthetic-token");
      expect(res.stderr).toContain("[redacted]");
      expect(res.stderr).toContain("using candidate 2/2");
    } finally {
      await live.close();
    }
  });
});
