// Bridge nouns slice (#15) — CLI-seam tests over synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart, type RouteHandler } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

type State = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
};

function st(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): State {
  return {
    entity_id,
    state,
    attributes,
    last_changed: ago(30),
    last_updated: ago(30),
  };
}

/** Numeric + state_class sensors mixed with excluded domains/non-numeric rows. */
const STATES = (): State[] => [
  st("light.kitchen", "on", { friendly_name: "Kitchen Light" }),
  st("switch.coffee_machine", "off"),
  st("sensor.kitchen_temperature", "21.5", {
    state_class: "measurement",
    unit_of_measurement: "°C",
  }),
  st("sensor.energy_total", "3.25", { state_class: "total_increasing", unit: "kWh" }),
  st("sensor.no_unit", "42"), // numeric but no state_class -> still a candidate
  st("binary_sensor.door", "on"), // wrong domain -> never a candidate
  st("sensor.text_note", "open sesame"), // non-numeric, no class -> excluded
];

const REGISTRIES: Record<string, unknown> = {
  "config/area_registry/list": [
    { area_id: "kitchen_area", name: "Kitchen", aliases: ["Cooking"] },
    { area_id: "living_room_area", name: "Living room", aliases: [] },
  ],
  "config/device_registry/list": [
    { id: "dev_kitchen_hub", area_id: "kitchen_area", name: "Hub" },
    { id: "dev_living_speaker", area_id: "living_room_area", name: "Speaker" },
    { id: "dev_unassigned", area_id: null, name: "Spare" },
  ],
  "config/entity_registry/list": [
    { entity_id: "light.kitchen", area_id: null, device_id: "dev_kitchen_hub" },
    { entity_id: "sensor.kitchen_temperature", area_id: null, device_id: "dev_kitchen_hub" },
    { entity_id: "light.living_room", area_id: null, device_id: "dev_living_speaker" },
    { entity_id: "switch.coffee_machine", area_id: null, device_id: null },
  ],
};

function fakeWithStates(extra: Record<string, RouteHandler> = {}) {
  return startFakeHa(
    { "GET /api/states": STATES(), ...extra },
    { ws: ({ type }) => REGISTRIES[type] },
  );
}

function docs(stdout: string): Record<string, unknown>[] {
  return toonPart(stdout)
    .trim()
    .split(/\n---\n/)
    .map((part) => decode(part) as Record<string, unknown>);
}

/**
 * Every bridge interaction must be exactly ONE command per connection (after
 * the auth frame) and then close — the one-shot contract.
 */
function commandsOf(fake: { wsReceived: unknown[] }): Record<string, unknown>[] {
  const frames = fake.wsReceived as Array<Record<string, unknown>>;
  const auths = frames.filter((f) => f.type === "auth");
  expect(auths.length).toBeGreaterThan(0);
  return frames.filter((f) => f.type !== "auth");
}

// ---------- area ----------

describe("area list", () => {
  it("joins the entity registry for counts, sorted by name", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["area", "list"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({ areas: 2 });
      expect(parts[1]["areas"]).toEqual([
        { id: "kitchen_area", name: "Kitchen", count: 2 },
        { id: "living_room_area", name: "Living room", count: 1 },
      ]);
      // One-shot bridge: three registries, each over its own connection with
      // exactly one command frame, then closed.
      const cmds = commandsOf(fake);
      expect(cmds).toHaveLength(3);
      for (const cmd of cmds) {
        expect(cmd.id).toBe(1);
        expect(Object.keys(REGISTRIES)).toContain(cmd.type);
      }
    } finally {
      await fake.close();
    }
  });

  it("stays definitive when no areas exist", async () => {
    const fake = await startFakeHa(
      {},
      { ws: ({ type }) => ({ "config/area_registry/list": [] }[type] ?? []) },
    );
    try {
      const res = await runCli(["area", "list"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(docs(res.stdout)[0]).toMatchObject({ count: 0 });
    } finally {
      await fake.close();
    }
  });
});

describe("area get", () => {
  it("resolves an alias case-insensitively and previews entities", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["area", "get", "cooking"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({
        id: "kitchen_area",
        name: "Kitchen",
        alias_count: 1,
        entities: 2,
      });
      expect(parts[1]["entities"]).toEqual([
        "light.kitchen",
        "sensor.kitchen_temperature",
      ]);
      expect(res.stdout).toContain("entity list --area Kitchen");
    } finally {
      await fake.close();
    }
  });

  it("maps an unknown area to NOT_FOUND", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["area", "get", "garage"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(1);
      expect(docs(res.stdout)[0].code).toBe("NOT_FOUND");
    } finally {
      await fake.close();
    }
  });
});

// ---------- device ----------

describe("device list", () => {
  it("lists all devices with area names and entity counts", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["device", "list"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[1]["devices"]).toEqual([
        { id: "dev_kitchen_hub", name: "Hub", area: "Kitchen", entities: 2 },
        { id: "dev_unassigned", name: "Spare", area: null, entities: 0 },
        { id: "dev_living_speaker", name: "Speaker", area: "Living room", entities: 1 },
      ]);
      const cmds = commandsOf(fake);
      expect(cmds.map((c) => c.type).sort()).toEqual([
        "config/area_registry/list",
        "config/device_registry/list",
        "config/entity_registry/list",
      ]);
    } finally {
      await fake.close();
    }
  });

  it("filters by resolved area name case-insensitively", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["device", "list", "--area", "LIVING ROOM"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({ devices: 1 });
      expect(parts[1]["devices"]).toEqual([
        { id: "dev_living_speaker", name: "Speaker", area: "Living room", entities: 1 },
      ]);
    } finally {
      await fake.close();
    }
  });

  it("rejects an unknown --area with NOT_FOUND before listing", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["device", "list", "--area", "garage"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(1);
      expect(docs(res.stdout)[0].code).toBe("NOT_FOUND");
    } finally {
      await fake.close();
    }
  });
});

// ---------- statistics ids ----------

describe("statistics ids", () => {
  it("derives candidates from numeric sensor states only", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["statistics", "ids"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      // Derived from REST states only — the bridge stays untouched.
      expect(fake.wsReceived).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });
});

// ---------- statistics get ----------

describe("statistics get", () => {
  it("sends recorder/statistics_during_period and renders summary rows", async () => {
    let periodResult: unknown;
    const fake = await startFakeHa(
      {},
      {
        ws: ({ type, payload }) => {
          if (type !== "recorder/statistics_during_period") return {};
          return (periodResult = {
            [String(payload["statistic_ids"]?.[0])]: [
              {
                start: ago(90),
                mean: 21.4,
                min: 20.9,
                max: 22.1,
                sum: 512.4,
              },
            ],
          });
        },
      },
    );
    try {
      const res = await runCli(
        [
          "statistics",
          "get",
          "sensor.kitchen_temperature",
          "--start",
          "2024-05-06T07:08:09Z",
          "--period",
          "hour",
        ],
        { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } },
      );
      expect(res.status).toBe(0);
      // Exact WS request body asserted off the recorded frame.
      const cmds = commandsOf(fake);
      expect(cmds).toHaveLength(1);
      expect(cmds[0]).toEqual({
        id: 1,
        type: "recorder/statistics_during_period",
        statistic_ids: ["sensor.kitchen_temperature"],
        start_time: "2024-05-06T07:08:09.000Z",
        period: "hour",
      });
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({ statistics: 1 });
      expect(parts[1]["sensor.kitchen_temperature"]).toEqual([
        {
          id: "sensor.kitchen_temperature",
          start: expect.stringMatching(/^\d+h$/),
          mean: 21.4,
          min: 20.9,
          max: 22.1,
        },
      ]);
      expect(periodResult).toBeDefined();
    } finally {
      await fake.close();
    }
  });

  it("defaults the window to now-24h with period day", async () => {
    const fake = await startFakeHa({}, { ws: () => ({}) });
    try {
      const res = await runCli(["statistics", "get", "sensor.energy_total"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const cmd = commandsOf(fake)[0];
      expect(cmd.period).toBe("day");
      const startMs = new Date(String(cmd.start_time)).getTime();
      expect(Math.abs(startMs - (NOW - DAY_MS))).toBeLessThan(5 * 60_000);
      // Empty result bucket stays definitive.
      expect(docs(res.stdout)).toContainEqual({ statistics: 0 });
      expect(res.stdout).toContain("no data: sensor.energy_total");
    } finally {
      await fake.close();
    }
  });

  it("rejects an invalid --period before any network call", async () => {
    const fake = await startFakeHa({});
    try {
      const res = await runCli(
        ["statistics", "get", "sensor.energy_total", "--period", "year"],
        { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } },
      );
      expect(res.status).toBe(2);
      expect(docs(res.stdout)[0].code).toBe("VALIDATION_ERROR");
      expect(fake.hits.length).toBe(0);
      expect(fake.wsReceived).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });
});
