import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart, type FakeHa } from "./helpers.js";

let home: string;
let fake: FakeHa;

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ha-axi-dash-"));
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

async function start(routes: Record<string, unknown>): Promise<void> {
  fake = await startFakeHa(routes);
}

describe("bare dashboard", () => {
  it("renders all four blocks from exactly two HTTP hits", async () => {
    await start({
      "GET /api/config": { version: "2026.8.0" },
      "GET /api/states": [
        { entity_id: "light.kitchen", state: "on", attributes: {}, last_updated: iso(5) },
        { entity_id: "light.bedroom", state: "off", attributes: {}, last_updated: iso(30) },
        { entity_id: "sensor.temp", state: "21.5", attributes: { battery_level: 80 }, last_updated: iso(2) },
        { entity_id: "sensor.low", state: "17", attributes: { battery_level: 19.9 }, last_updated: iso(1) },
        { entity_id: "sensor.edge", state: "18", attributes: { battery_level: 20 }, last_updated: iso(1) },
        { entity_id: "sensor.dead", state: "unavailable", attributes: {}, last_updated: iso(3) },
        { entity_id: "sensor.unknown", state: "unknown", attributes: {}, last_updated: iso(4) },
        { entity_id: "sensor.old", state: "42", attributes: {}, last_updated: iso(25 * 60) },
      ],
    });
    try {
      const res = await runCli([], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
        homeDir: home,
      });
      expect(res.status).toBe(0);
      // one states fetch + one config fetch, nothing else
      expect(fake.hits).toHaveLength(2);
      expect(fake.hitCount("GET", "/api/states")).toBe(1);
      expect(fake.hitCount("GET", "/api/config")).toBe(1);

      expect(res.stdout).toContain("profile: default · version: 2026.8.0 · 8 entities");
      expect(res.stdout).toContain("light: 2");
      expect(res.stdout).toContain("sensor: 6");
      expect(res.stdout).toContain("unavailable[2]: sensor.dead,sensor.unknown");
      expect(res.stdout).toContain('"- sensor.low (19.9%)"');
      expect(res.stdout).not.toContain("sensor.edge");
      expect(res.stdout).toContain("stale[1]: sensor.old");
      // closes with the two help lines
      expect(res.stdout).toContain("help[2]:");
      expect(res.stdout).toContain("entity list");
      expect(res.stdout).toContain("service list --domain <d>");
    } finally {
      await fake.close();
    }
  });

  it("keeps AUTH_MISSING structured when no credentials resolve", async () => {
    const dead = await runCli([], {
      env: { HASS_URL: undefined, HASS_TOKEN: undefined },
      homeDir: home,
    });
    expect(dead.status).toBe(2);
    const doc = decode(toonPart(dead.stdout)) as Record<string, unknown>;
    expect(doc.code).toBe("AUTH_MISSING");
  });

  it("low_battery threshold: 20 excluded, 19.9 included", async () => {
    await start({
      "GET /api/config": { version: "2026.8.0" },
      "GET /api/states": [
        { entity_id: "sensor.at20", state: "ok", attributes: { battery_level: 20 }, last_updated: iso(1) },
        { entity_id: "sensor.below", state: "ok", attributes: { battery_level: "19.9" }, last_updated: iso(1) },
        { entity_id: "sensor.pct", state: "ok", attributes: { battery_level: 15 }, last_updated: iso(1) },
      ],
    });
    try {
      const res = await runCli([], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
        homeDir: home,
      });
      expect(res.status).toBe(0);
      expect(fake.hits).toHaveLength(2);
      expect(res.stdout).toContain('"- sensor.below (19.9%)"');
      expect(res.stdout).toContain('"- sensor.pct (15%)"');
      expect(res.stdout).not.toContain("sensor.at20");
    } finally {
      await fake.close();
    }
  });

  it("stale flags entities last_updated more than 24h old only", async () => {
    await start({
      "GET /api/config": { version: "2026.8.0" },
      "GET /api/states": [
        { entity_id: "sensor.fresh23h", state: "ok", attributes: {}, last_updated: iso(23 * 60 + 59) },
        { entity_id: "sensor.stale24h", state: "ok", attributes: {}, last_updated: iso(24 * 60 + 1) },
      ],
    });
    try {
      const res = await runCli([], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
        homeDir: home,
      });
      expect(res.status).toBe(0);
      expect(fake.hits).toHaveLength(2);
      expect(res.stdout).toContain("stale[1]: sensor.stale24h");
      expect(res.stdout).not.toContain("sensor.fresh23h");
    } finally {
      await fake.close();
    }
  });
});
