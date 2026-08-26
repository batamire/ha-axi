import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const execFileP = promisify(execFile);
const root = join(dirname(new URL(import.meta.url).pathname), "..");
const tsx = join(root, "node_modules", ".bin", "tsx");
const skillPath = join(root, "skills", "ha-axi", "SKILL.md");

describe("build-skill drift gate", () => {
  it("--check passes when up to date and fails when stale", async () => {
    const clean = await execFileP(tsx, ["scripts/build-skill.ts", "--check"], { cwd: root });
    expect(clean.stdout).toContain("up to date");

    const original = await readFile(skillPath, "utf-8");
    try {
      await writeFile(skillPath, `${original}\n<!-- drifted -->`, "utf-8");
      await expect(execFileP(tsx, ["scripts/build-skill.ts", "--check"], { cwd: root })).rejects.toMatchObject({
        code: 1,
      });
    } finally {
      await writeFile(skillPath, original, "utf-8");
    }
  });

  it("committed SKILL.md carries frontmatter with required trigger keywords", async () => {
    const md = await readFile(skillPath, "utf-8");
    expect(md.startsWith("---\n")).toBe(true);
    for (const keyword of ["Home Assistant", "hass", "ha-axi", "Zigbee", "HomeKit", "Matter", "Thread"]) {
      expect(md.split("---")[1]).toContain(keyword);
    }
  });

  it("SKILL.md documents auth bootstrap and safety posture", async () => {
    const md = await readFile(skillPath, "utf-8");
    expect(md).toContain("Long-lived access tokens");
    expect(md).toContain("HASS_URL");
    expect(md).toContain("`ha-axi ping`");
    expect(md).toContain("DOMAIN_EXCLUDED");
    expect(md).toContain("--dry-run");
    // command table mirrors COMMAND_SUMMARY
    for (const cmd of ["ping", "entity", "service", "template", "history", "logbook", "area", "device", "statistics", "setup"]) {
      expect(md).toContain(`| \`${cmd}\` |`);
    }
  });
});
