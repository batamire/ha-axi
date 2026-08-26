// Entity noun slice (#12) — CLI-seam tests over synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart, type RouteHandler } from "./helpers.js";

// ---------- synthetic fixtures ----------

type State = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
};

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function st(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
  changedMin = 30,
): State {
  return {
    entity_id,
    state,
    attributes,
    last_changed: ago(changedMin),
    last_updated: ago(changedMin),
  };
}

const STATES = (): State[] => [
  st("light.kitchen", "on", { friendly_name: "Kitchen Light", brightness_pct: 80 }, 42),
  st("light.living_room", "off", { friendly_name: "Living Room Light" }, 180),
  st("light.hallway", "unavailable", { friendly_name: "Hallway Light" }, 2880),
  st("sensor.living_room_temperature", "21.9", {
    friendly_name: "Living Room Temperature",
    device_class: "temperature",
  }),
  st("switch.coffee_machine", "off", { friendly_name: "Coffee Machine" }, 600),
  st("sensor.cpu_speed", "42.0", {
    friendly_name: "CPU Speed",
    entity_category: "diagnostic",
    unit_of_measurement: "%",
  }, 5),
  st("binary_sensor.zigbee_coordinator", "on", {
    friendly_name: "Zigbee Coordinator",
    entity_category: "config",
  }, 7),
];

const REGISTRIES: Record<string, unknown> = {
  "config/area_registry/list": [
    { area_id: "kitchen_area", name: "Kitchen" },
    { area_id: "living_room_area", name: "Living room" },
  ],
  "config/device_registry/list": [
    { id: "dev_kitchen_hub", area_id: "kitchen_area" },
    { id: "dev_unassigned", area_id: null },
  ],
  "config/entity_registry/list": [
    // own area wins
    { entity_id: "light.living_room", area_id: "living_room_area", device_id: null },
    // inherits the device's area when its own is null
    { entity_id: "light.kitchen", area_id: null, device_id: "dev_kitchen_hub" },
    { entity_id: "switch.coffee_machine", area_id: null, device_id: null },
  ],
};

/** Fake HA serving /api/states plus (optionally) the WS registries. */
async function fakeWithStates(extra: Record<string, RouteHandler> = {}, withWs = true) {
  return startFakeHa(
    {
      "GET /api/states": STATES(),
      ...extra,
    },
    withWs ? { ws: ({ type }) => REGISTRIES[type] } : undefined,
  );
}

/** Split the pre-help stdout into TOON documents separated by `---` lines. */
function docs(stdout: string): Record<string, unknown>[] {
  return toonPart(stdout)
    .trim()
    .split(/\n---\n/)
    .map((part) => decode(part) as Record<string, unknown>);
}

describe("entity list", () => {
  it("emits curated rows plus full-set aggregates and a help block", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["entity", "list"], { env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" } });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      const parts = docs(res.stdout);
      // aggregates span the FULL fetched set even under curation
      expect(parts[0]).toEqual({ count: "4 of 7 total", unavailable: "1 hidden" });
      const entities = parts[1].entities as Record<string, unknown>[];
      expect(entities).toHaveLength(4);
      expect(entities.map((e) => e.id)).toEqual([
        "light.kitchen",
        "light.living_room",
        "sensor.living_room_temperature",
        "switch.coffee_machine",
      ]);
      for (const row of entities) {
        expect(Object.keys(row).sort()).toEqual(["changed", "id", "name", "state"]);
        expect(String(row.changed)).toMatch(/^\d+[mhd]$/);
      }
      expect(res.stdout).toContain("help[2]:");
      expect(res.stdout).toContain("entity get <id> for detail");
    } finally {
      await fake.close();
    }
  });

  it("--all disables both curated exclusions and drops the hidden line", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["entity", "list", "--all"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({ count: "7 of 7 total" });
      expect(parts).toHaveLength(2); // no `unavailable:` aggregate behind --all
      const ids = (parts[1].entities as Record<string, unknown>[]).map((e) => e.id);
      expect(ids).toContain("light.hallway"); // unavailable state shown
      expect(ids).toContain("sensor.cpu_speed"); // diagnostic category shown
      expect(ids).toContain("binary_sensor.zigbee_coordinator"); // config category shown
    } finally {
      await fake.close();
    }
  });

  it("--domain filters rows while aggregate totals stay full-set", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["entity", "list", "--domain", "light"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts[0]).toEqual({ count: "2 of 7 total", unavailable: "1 hidden" });
      const ids = (parts[1].entities as Record<string, unknown>[]).map((e) => e.id);
      expect(ids).toEqual(["light.kitchen", "light.living_room"]);
    } finally {
      await fake.close();
    }
  });

  it("--query matches id AND friendly_name substrings", async () => {
    const fake = await fakeWithStates();
    try {
      // 'room temp' only appears in the friendly name, not in any entity id
      const byName = await runCli(["entity", "list", "--query", "room temp"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      const partsName = docs(byName.stdout);
      expect(
        (partsName[1].entities as Record<string, unknown>[]).map((e) => e.id),
      ).toEqual(["sensor.living_room_temperature"]);

      const byId = await runCli(["entity", "list", "--query=coffee"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      const partsId = docs(byId.stdout);
      expect(partsId[0]).toEqual({ count: "1 of 7 total", unavailable: "1 hidden" });
      expect((partsId[1].entities as Record<string, unknown>[])[0].id).toBe("switch.coffee_machine");
    } finally {
      await fake.close();
    }
  });

  it("--area resolves names via the WS registry incl. inherited device areas", async () => {
    const fake = await fakeWithStates();
    try {
      const kitchen = await runCli(["entity", "list", "--area", "kitchen"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(kitchen.status).toBe(0);
      const partsK = docs(kitchen.stdout);
      expect((partsK[1].entities as Record<string, unknown>[]).map((e) => e.id)).toEqual(["light.kitchen"]);
      const living = await runCli(["entity", "list", "--area", "living room"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      const partsL = docs(living.stdout);
      expect((partsL[1].entities as Record<string, unknown>[]).map((e) => e.id)).toEqual(["light.living_room"]);
    } finally {
      await fake.close();
    }
  });

  it("--counts appends a domain map spanning the full set", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["entity", "list", "--counts"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const parts = docs(res.stdout);
      expect(parts).toHaveLength(3);
      expect(parts[2].domain).toEqual({
        light: 3,
        sensor: 2,
        switch: 1,
        binary_sensor: 1,
      });
    } finally {
      await fake.close();
    }
  });

  it("returns a definitive empty shape with a --all retry hint on no matches", async () => {
    const fake = await fakeWithStates();
    try {
      const res = await runCli(["entity", "list", "--query", "garage"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0); // empty results are definitive, not errors
      expect(docs(res.stdout)).toEqual([
        {
          count: 0,
          note: "no entities match 'garage'",
          hint: "3 entities hidden by curated view; retry with --all",
        },
      ]);

      const all = await runCli(["entity", "list", "--all", "--query", "garage"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(docs(all.stdout)[0].hint).toBe("retry with fewer filters");
    } finally {
      await fake.close();
    }
  });
});

describe("entity get", () => {
  function detailFixture(): State[] {
    return [
      st("light.kitchen", "on", {
        friendly_name: "Kitchen Light",
        brightness_pct: 80,
        supported_color_modes: ["color_temp", "xy"],
        effect_list: ["none", "colorloop"],
        color: { h: 45.0, s: 900.1 },
      }, 42),
    ];
  }

  async function fakeWithDetail() {
    return startFakeHa(
      { "GET /api/states/light.kitchen": detailFixture()[0] },
      { ws: ({ type }) => REGISTRIES[type] },
    );
  }

  it("shows detail + scalar attrs, eliding arrays/objects, and suggests a service call", async () => {
    const fake = await fakeWithDetail();
    try {
      const res = await runCli(["entity", "get", "light.kitchen"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const doc = docs(res.stdout)[0];
      expect(doc.id).toBe("light.kitchen");
      expect(doc.name).toBe("Kitchen Light");
      expect(doc.state).toBe("on");
      expect(doc.area).toBe("Kitchen"); // inherited from the device registry
      expect(doc.attrs).toEqual({
        brightness_pct: 80,
        supported_color_modes: "array[2] — use --full",
        effect_list: "array[2] — use --full",
        color: "object[2] — use --full",
      });
      expect(res.stdout).toContain("service call light.turn_on --entity light.kitchen");
      expect(res.stdout).toContain("help[1]:");
    } finally {
      await fake.close();
    }
  });

  it("--full reveals elided arrays/objects", async () => {
    const fake = await fakeWithDetail();
    try {
      const res = await runCli(["entity", "get", "light.kitchen", "--full"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      const attrs = docs(res.stdout)[0].attrs as Record<string, unknown>;
      expect(attrs.supported_color_modes).toEqual(["color_temp", "xy"]);
      expect(attrs.effect_list).toEqual(["none", "colorloop"]);
      expect(attrs.color).toEqual({ h: 45, s: 900.1 });
    } finally {
      await fake.close();
    }
  });

  it("maps an unknown entity id to NOT_FOUND", async () => {
    const fake = await fakeWithStates(); // no per-entity route → 404 from the fake
    try {
      const res = await runCli(["entity", "get", "light.missing"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).not.toBe(0);
      expect(docs(res.stdout)[0].code).toBe("NOT_FOUND");
    } finally {
      await fake.close();
    }
  });

  it("suggests service discovery for non-switchable domains", async () => {
    const sensor = st("sensor.porch", "12.5", { friendly_name: "Porch" }, 10);
    const fake = await startFakeHa(
      { "GET /api/states/sensor.porch": sensor },
      { ws: ({ type }) => REGISTRIES[type] },
    );
    try {
      const res = await runCli(["entity", "get", "sensor.porch"], {
        env: { HASS_URL: fake.url, HASS_TOKEN: "synthetic-token" },
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("service list --domain sensor to discover services");
    } finally {
      await fake.close();
    }
  });
});

describe("top-level help", () => {
  it("no longer marks entity as planned-only", async () => {
    const res = await runCli(["--help"], { env: { HASS_URL: "https://hass.example", HASS_TOKEN: "synthetic-token" } });
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("(planned) List and inspect entities");
    expect(res.stdout).toContain("`list`, `get`");
  });
});
