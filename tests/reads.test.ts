// Reads slice (#14) — CLI-seam tests over synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart, type FakeHa } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type State = {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
};

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function st(entity_id: string, state: string, changedMin: number): State {
  const iso = ago(changedMin);
  return { entity_id, state, last_changed: iso, last_updated: iso };
}

/** Decode the leading TOON document of stdout. */
function leadDoc(stdout: string): Record<string, unknown> {
  return decode(toonPart(stdout).trim()) as Record<string, unknown>;
}

// ---------- template render ----------

describe("template render", () => {
  it("POSTs the template body and decodes the rendered result", async () => {
    let capturedBody: unknown;
    const fake = await startFakeHa({
      "/api/template": ({ body }) => {
        capturedBody = body;
        return { text: "heat" };
      },
    });
    try {
      const res = await runCli(
        ["template", "render", "{{ states('light.kitchen') }}"],
        { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } },
      );
      expect(res.status).toBe(0);
      expect(capturedBody).toEqual({ template: "{{ states('light.kitchen') }}" });
      expect(leadDoc(res.stdout)).toEqual({ result: "heat" });
      expect(res.stdout).toContain("help[1]:");
    } finally {
      await fake.close();
    }
  });

  it("keeps multi-line results verbatim inside the encoded value", async () => {
    const fake = await startFakeHa({
      "/api/template": () => ({ text: "line one\nline two\nline three" }),
    });
    try {
      const res = await runCli(["template", "render", "{{ 'x' }}"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(leadDoc(res.stdout)).toEqual({ result: "line one\nline two\nline three" });
    } finally {
      await fake.close();
    }
  });

  it("notes an empty rendering via the help line", async () => {
    const fake = await startFakeHa({ "/api/template": () => ({ text: "" }) });
    try {
      const res = await runCli(["template", "render", "{{ '' }}"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(leadDoc(res.stdout)).toEqual({ result: "" });
      expect(res.stdout).toContain("empty string");
    } finally {
      await fake.close();
    }
  });
});

// ---------- history get ----------

describe("history get", () => {
  it("shows two entities and flags an empty timeline as definitive no-data", async () => {
    let requestedUrl = "";
    const fake = await startFakeHa({
      "/api/history/period/*": ({ url }) => {
        requestedUrl = url ?? "";
        return [
          [st("light.kitchen", "on", 10), st("light.kitchen", "off", 40)],
          [],
        ];
      },
    });
    try {
      const res = await runCli(["history", "get", "light.kitchen", "sensor.absent"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(requestedUrl).toContain("filter_entity_id=light.kitchen%2Csensor.absent");
      expect(requestedUrl).toContain("minimal_response=1");
      expect(res.stdout).toContain("entities: 1");
      expect(res.stdout).toContain("no data: sensor.absent");
      // Per-entity block keyed by id with compact rows {state, changed}.
      const parts = toonPart(res.stdout).split("\n---\n");
      expect(parts).toHaveLength(3);
      const doc = decode(parts[1]) as Record<string, unknown>;
      const rows = doc["light.kitchen"] as Array<{ state: string; changed: string }>;
      expect(rows).toEqual([
        { state: "on", changed: expect.stringMatching(/^\d+m$/) },
        { state: "off", changed: expect.stringMatching(/^\d+m$/) },
      ]);
    } finally {
      await fake.close();
    }
  });

  it("computes the default window as now-24h within tolerance", async () => {
    let requestedUrl = "";
    const fake = await startFakeHa({
      "/api/history/period/*": ({ url }) => {
        requestedUrl = url ?? "";
        return [];
      },
    });
    try {
      const res = await runCli(["history", "get", "light.kitchen"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const match = /\/api\/history\/period\/([^?]+)/.exec(requestedUrl);
      expect(match).not.toBeNull();
      const startMs = new Date(decodeURIComponent(match![1])).getTime();
      expect(Math.abs(startMs - (NOW - DAY_MS))).toBeLessThan(5 * 60_000);
      expect(res.stdout).toContain("entities: 0");
      expect(res.stdout).toContain("no data: light.kitchen");
    } finally {
      await fake.close();
    }
  });

  it("passes explicit --start through on the path and --end as end_time", async () => {
    let requestedUrl = "";
    const fake = await startFakeHa({
      "/api/history/period/*": ({ url }) => {
        requestedUrl = url ?? "";
        return [[st("switch.hall", "on", 90)]];
      },
    });
    try {
      const res = await runCli(
        [
          "history",
          "get",
          "switch.hall",
          "--start",
          "2024-05-06T07:08:09Z",
          "--end",
          "2024-05-06T08:08:09Z",
        ],
        { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } },
      );
      expect(res.status).toBe(0);
      expect(requestedUrl.startsWith("/api/history/period/2024-05-06T07%3A08%3A09")).toBe(true);
      expect(requestedUrl).toContain("end_time=2024-05-06T08%3A08%3A09");
      expect(res.stdout).toContain("entities: 1");
    } finally {
      await fake.close();
    }
  });

  it("rejects a garbage --start before any network call", async () => {
    const fake = await startFakeHa({});
    try {
      const res = await runCli(
        ["history", "get", "light.kitchen", "--start", "yesterday-ish"],
        { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } },
      );
      expect(res.status).toBe(2);
      expect(leadDoc(res.stdout).code).toBe("VALIDATION_ERROR");
      expect(fake.hits.length).toBe(0);
    } finally {
      await fake.close();
    }
  });
});

// ---------- logbook get ----------

describe("logbook get", () => {
  it("lists entries with relative when plus a count aggregate", async () => {
    let requestedUrl = "";
    const fake = await startFakeHa({
      "/api/logbook/*": ({ url }) => {
        requestedUrl = url ?? "";
        return [
          { when: ago(30), name: "Kitchen Light", state: "off", entity_id: "light.kitchen" },
          { when: ago(90), name: "Hall Switch", state: "", message: "turned on", entity_id: "switch.hall" },
        ];
      },
    });
    try {
      const res = await runCli(["logbook", "get", "light.kitchen"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(requestedUrl).toContain("entity=light.kitchen");
      expect(res.stdout).toContain("count: 2");
      const docPart = toonPart(res.stdout.split("---\n")[1] ?? "");
      const doc = decode(docPart.trim()) as { entries: Array<Record<string, string>> };
      expect(doc.entries).toHaveLength(2);
      expect(doc.entries[0]).toMatchObject({
        name: "Kitchen Light",
        state: "off",
        entity_id: "light.kitchen",
        when: expect.stringMatching(/^\d+m$/),
      });
      // Message-only entry falls back to its message text.
      expect(doc.entries[1]).toMatchObject({ state: "turned on", when: "1h" });
      expect(res.stdout).toContain("help[1]:");
    } finally {
      await fake.close();
    }
  });

  it("stays definitive at zero with a widen-the-window hint", async () => {
    const fake = await startFakeHa({ "/api/logbook/*": () => [] });
    try {
      const res = await runCli(["logbook", "get"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(leadDoc(res.stdout)).toEqual({
        count: 0,
        note: "no logbook entries in window",
        hint: "widen the window with --start/--end",
      });
    } finally {
      await fake.close();
    }
  });

  it("rejects a garbage --start before any network call", async () => {
    const fake = await startFakeHa({});
    try {
      const res = await runCli(["logbook", "get", "--start", "not-a-date"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(2);
      expect(leadDoc(res.stdout).code).toBe("VALIDATION_ERROR");
      expect(fake.hits.length).toBe(0);
    } finally {
      await fake.close();
    }
  });
});
