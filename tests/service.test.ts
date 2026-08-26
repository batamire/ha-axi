// Service noun slice (#13) — CLI-seam tests over synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { isIdempotentService } from "../src/safety.js";
import { hitCount, runCli, startFakeHa, toonPart, type FakeHa } from "./helpers.js";

const ENV = { HASS_URL: "https://hass.example", HASS_TOKEN: "synthetic-token" };

// GET /api/services fixture: synthetic domains/services only.
function servicesFixture(): unknown {
  return [
    {
      domain: "light",
      services: {
        turn_on: { description: "Turn light on" },
        turn_off: { description: "Turn light off" },
        toggle: { description: "Toggle light" },
      },
    },
    {
      domain: "scene",
      services: { turn_on: { description: "Activate scene" } },
    },
  ];
}

/** POST /api/services/<domain>/<service> echoes changed states for the target. */
function callRoute(): RouteHandler {
  return ({ body }) => {
    let ids = ["light.kitchen"];
    if (body && typeof body === "object" && "entity_id" in body) {
      const raw: unknown = body.entity_id;
      if (Array.isArray(raw)) ids = raw.map(String);
    }
    return ids.map((id) => ({ entity_id: id, state: "on" }));
  };
}

/** Fake HA serving service routes and recording every hit. */
async function fakeWithServices(): Promise<FakeHa> {
  return startFakeHa({
    "/api/services": servicesFixture,
    "/api/services/light/turn_on": callRoute(),
  });
}

/** Decode the leading TOON document of stdout. */
function leadDoc(stdout: string): Record<string, unknown> {
  return decode(toonPart(stdout).trim()) as Record<string, unknown>;
}

/** Decode the second TOON document (after a `---` separator). */
function secondDoc(stdout: string): Record<string, unknown> {
  return decode(toonPart(stdout.split("---\n")[1] ?? "").trim()) as Record<string, unknown>;
}

describe("service list", () => {
  it("lists rows with curated idempotency metadata", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "list", "--domain", "light"], { env: { ...ENV, HASS_URL: fake.url } });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("count: 3");
      expect(res.stdout).toContain("service call light.turn_on --entity <id>");
      const doc = secondDoc(res.stdout) as {
        services: Array<{ service: string; idempotent: boolean; desc: string }>;
      };
      expect(doc.services).toEqual([
        { service: "turn_on", idempotent: true, desc: "Turn light on" },
        { service: "turn_off", idempotent: true, desc: "Turn light off" },
        { service: "toggle", idempotent: false, desc: "Toggle light" },
      ]);
    } finally {
      await fake.close();
    }
  });

  it("qualifies service names when listing all domains", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "list"], { env: { ...ENV, HASS_URL: fake.url } });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("count: 4");
      expect(res.stdout).toContain("scene.turn_on");
    } finally {
      await fake.close();
    }
  });

  it("empty domain is definitive with exit 0", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "list", "--domain", "vacuum"], { env: { ...ENV, HASS_URL: fake.url } });
      expect(res.status).toBe(0);
      const doc = leadDoc(res.stdout) as { count: number; note: string };
      expect(doc.count).toBe(0);
      expect(doc.note).toContain("vacuum");
    } finally {
      await fake.close();
    }
  });
});

describe("gated-domain refusal (ADR 0001)", () => {
  for (const domain of ["lock", "alarm_control_panel", "cover"]) {
    it(`refuses service call in ${domain} before any network activity`, async () => {
      const fake = await startFakeHa({});
      try {
        const res = await runCli(
          ["service", "call", `${domain}.open`, "--entity", `${domain}.front`, "--i-mean-all"],
          { env: { ...ENV, HASS_URL: fake.url } },
        );
        expect(res.status).not.toBe(0);
        const doc = leadDoc(res.stdout) as { error: string; code: string };
        expect(doc.code).toBe("DOMAIN_EXCLUDED");
        expect(doc.error).toContain(domain);
        // No HTTP request of any kind may have been recorded — not even on --i-mean-all.
        expect(fake.hits).toEqual([]);
      } finally {
        await fake.close();
      }
    });

    it(`refuses ${domain} even on --dry-run`, async () => {
      const fake = await startFakeHa({});
      try {
        const res = await runCli(["service", "call", `${domain}.close`, "--dry-run"], {
          env: { ...ENV, HASS_URL: fake.url },
        });
        expect(res.status).not.toBe(0);
        expect(toonPart(res.stdout)).toContain("DOMAIN_EXCLUDED");
        expect(fake.hits).toEqual([]);
      } finally {
        await fake.close();
      }
    });
  }
});

describe("non-concrete target refusal", () => {
  it("refuses entity_id 'all'", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "call", "light.turn_on", "--entity", "all"], {
        env: { ...ENV, HASS_URL: fake.url },
      });
      expect(res.status).not.toBe(0);
      expect(toonPart(res.stdout)).toContain("BULK_TARGET_REFUSED");
      expect(hitCount(fake, "POST", "/api/services/light/turn_on")).toBe(0);
    } finally {
      await fake.close();
    }
  });

  it("refuses a missing explicit target", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "call", "light.turn_on"], { env: { ...ENV, HASS_URL: fake.url } });
      expect(res.status).not.toBe(0);
      expect(toonPart(res.stdout)).toContain("BULK_TARGET_REFUSED");
      expect(hitCount(fake, "POST", "/api/services/light/turn_on")).toBe(0);
    } finally {
      await fake.close();
    }
  });

  it("refuses area targeting as non-concrete", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "call", "light.turn_on", "--area", "kitchen"], {
        env: { ...ENV, HASS_URL: fake.url },
      });
      expect(res.status).not.toBe(0);
      expect(toonPart(res.stdout)).toContain("BULK_TARGET_REFUSED");
      expect(hitCount(fake, "POST", "/api/services/light/turn_on")).toBe(0);
    } finally {
      await fake.close();
    }
  });

  it("--i-mean-all overrides the bulk refusal", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(
        ["service", "call", "light.turn_on", "--entity", "all", "--i-mean-all"],
        { env: { ...ENV, HASS_URL: fake.url } },
      );
      expect(res.status).toBe(0);
      expect(hitCount(fake, "POST", "/api/services/light/turn_on")).toBe(1);
    } finally {
      await fake.close();
    }
  });
});

describe("--dry-run", () => {
  it("prints the resolved request and sends NOTHING", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(
        ["service", "call", "light.turn_on", "--entity", "light.kitchen", "--dry-run", "brightness=80"],
        { env: { ...ENV, HASS_URL: fake.url } },
      );
      expect(res.status).toBe(0);
      const doc = leadDoc(res.stdout) as {
        dry_run: boolean;
        service: string;
        target: string[];
        data: Record<string, unknown>;
      };
      expect(doc.dry_run).toBe(true);
      expect(doc.service).toBe("light.turn_on");
      expect(doc.target).toEqual(["light.kitchen"]);
      expect(doc.data).toEqual({ brightness: 80 });
      // Zero requests recorded — not even a GET.
      expect(fake.hits).toEqual([]);
    } finally {
      await fake.close();
    }
  });
});

describe("happy-path service call", () => {
  it("posts the correct body and renders returned states", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(
        [
          "service",
          "call",
          "light.turn_on",
          "--entity",
          "light.kitchen,light.hallway",
          "brightness=80",
          "effect=none",
          "flag_on=true",
        ],
        { env: { ...ENV, HASS_URL: fake.url } },
      );
      expect(res.status).toBe(0);

      const post = fake.hits.find((h) => h.method === "POST");
      expect(post?.path).toBe("/api/services/light/turn_on");
      expect(post?.body).toEqual({
        brightness: 80,
        effect: "none",
        flag_on: true,
        entity_id: ["light.kitchen", "light.hallway"],
      });

      expect(res.stdout).toContain("changed: 2");
      const doc = secondDoc(res.stdout) as { states: Array<{ id: string; state: string }> };
      expect(doc.states).toEqual([
        { id: "light.kitchen", state: "on" },
        { id: "light.hallway", state: "on" },
      ]);
      expect(res.stdout).toContain("entity get light.kitchen to verify");
    } finally {
      await fake.close();
    }
  });

  it("accepts entity_id as a data key", async () => {
    const fake = await fakeWithServices();
    try {
      const res = await runCli(["service", "call", "light.turn_on", "entity_id=light.desk"], {
        env: { ...ENV, HASS_URL: fake.url },
      });
      expect(res.status).toBe(0);
      const post = fake.hits.find((h) => h.method === "POST");
      expect(post?.body).toEqual({ entity_id: ["light.desk"] });
    } finally {
      await fake.close();
    }
  });
});

describe("error taxonomy passthrough", () => {
  it("maps HA 400 for an unknown service to VALIDATION_ERROR", async () => {
    const fake = await startFakeHa({
      "/api/services/nope/missing": () => ({
        status: 400,
        json: { message: "Service nope.missing not found." },
      }),
    });
    try {
      const res = await runCli(["service", "call", "nope.missing", "--entity", "light.kitchen"], {
        env: { ...ENV, HASS_URL: fake.url },
      });
      expect(res.status).not.toBe(0);
      const doc = leadDoc(res.stdout) as { error: string; code: string };
      expect(doc.code).toBe("VALIDATION_ERROR");
      expect(doc.error).toContain("Service nope.missing not found.");
    } finally {
      await fake.close();
    }
  });
});

describe("idempotent classifier", () => {
  it.each([
    ["turn_on", true],
    ["turn_off", true],
    ["set_temperature", true],
    ["volume_set", true],
    ["volume_mute", true],
    ["close_cover", true],
    ["open", true],
    ["stop_cover", true],
    ["lock", true],
    ["unlock", true],
    ["toggle", false],
    ["trigger", false],
    ["reload", false],
    ["fire", false],
  ])("%s → %s", (name, expected) => {
    expect(isIdempotentService(name)).toBe(expected);
  });
});
