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

  it("SKILL.md defers command guidance to the CLI instead of embedding it", async () => {
    const md = await readFile(skillPath, "utf-8");
    expect(md).toContain("- `npx -y ha-axi` for a dashboard");
    expect(md).toContain("npx -y ha-axi --help");
    expect(md).toContain("npx -y ha-axi <command> --help");
    // Duplicated surfaces drift between releases; keep them out.
    expect(md).not.toContain("| `ping` |");
    expect(md).not.toContain("HASS_TOKEN");
    expect(md).not.toContain("DOMAIN_EXCLUDED");
  });
});
