import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, startFakeHa, toonPart, writeConfig } from "./helpers.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ha-axi-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const ENV_CLEAN = { HASS_URL: undefined, HASS_TOKEN: undefined };

describe("config resolution", () => {
  it("resolves url/token from a selected profile via --profile", async () => {
    const fake = await startFakeHa({
      "GET /api/": { message: "API running." },
      "GET /api/config": { version: "2026.8.0" },
    });
    try {
      await writeConfig(
        home,
        `[profiles.bench]\nurl = "${fake.url}"\ntoken = "profile-token"\n\n[profiles.other]\nurl = "https://hass.example"\ntoken = "x"\n`,
      );
      const res = await runCli(["ping", "--profile", "bench"], { env: ENV_CLEAN, homeDir: home });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.profile).toBe("bench");
      expect(doc.ok).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it("falls back to the first defined profile when no --profile is given", async () => {
    const fake = await startFakeHa({
      "GET /api/": { message: "API running." },
      "GET /api/config": { version: "2026.8.0" },
    });
    try {
      await writeConfig(home, `[profiles.solo]\nurl = "${fake.url}"\ntoken = "profile-token"\n`);
      const res = await runCli(["ping"], { env: ENV_CLEAN, homeDir: home });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.profile).toBe("solo");
    } finally {
      await fake.close();
    }
  });

  it("accepts -p short form for profile selection", async () => {
    const fake = await startFakeHa({
      "GET /api/": { message: "API running." },
      "GET /api/config": { version: "2026.8.0" },
    });
    try {
      await writeConfig(
        home,
        `[profiles.alpha]\nurl = "${fake.url}"\ntoken = "t"\n\n[profiles.beta]\nurl = "https://hass.example"\ntoken = "x"\n`,
      );
      const res = await runCli(["ping", "-p", "alpha"], { env: ENV_CLEAN, homeDir: home });
      expect(res.status).toBe(0);
      const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
      expect(doc.profile).toBe("alpha");
    } finally {
      await fake.close();
    }
  });

  it("warns to stderr when the config file is group/world readable", async () => {
    const fake = await startFakeHa({ "GET /api/": { message: "API running." } });
    try {
      await writeConfig(home, `[profiles.solo]\nurl = "${fake.url}"\ntoken = "t"\n`, 0o644);
      const res = await runCli(["ping", "-p", "solo"], { env: ENV_CLEAN, homeDir: home });
      expect(res.stderr).toContain("chmod 600");
    } finally {
      await fake.close();
    }
  });

  it("errors with AUTH_MISSING when no credentials exist at all", async () => {
    const res = await runCli(["ping"], {
      env: ENV_CLEAN,
      homeDir: join(home, "empty-home"),
    });
    expect(res.status).not.toBe(0);
    const doc = decode(toonPart(res.stdout)) as Record<string, unknown>;
    expect(doc.code).toBe("AUTH_MISSING");
  });
});
