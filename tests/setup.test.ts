import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { decode } from "@toon-format/toon";
import { runCli, toonPart } from "./helpers.js";

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "ha-axi-setup-"));
  tempHomes.push(home);
  return home;
}

async function envelope(args: string[], homeDir: string): Promise<{ status: number; doc: Record<string, unknown>; stdout: string }> {
  const res = await runCli(["setup", ...args], { homeDir });
  return { status: res.status, doc: decode(toonPart(res.stdout)) as Record<string, unknown>, stdout: res.stdout };
}

describe("setup hooks", () => {
  it("reports DRIFT when nothing is installed", async () => {
    const home = await tempHome();
    const { status, doc } = await envelope(["hooks", "--check"], home);
    expect(status).toBe(0);
    expect(doc.code).toBe("DRIFT");
    const hooks = doc.hooks as Record<string, unknown>;
    expect(hooks.claude).toBe("missing");
    expect(hooks.codex).toBe("missing");
    expect(hooks.opencode).toBe("missing");
    expect(hooks.codexConfig).toBe("missing");
  });

  it("installs marker-based hook configs for all three agents", async () => {
    const home = await tempHome();
    const { status, doc } = await envelope(["hooks"], home);
    expect(status).toBe(0);
    expect(doc.code).toBe("OK");

    const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf-8"));
    expect(JSON.stringify(claude)).toContain("ha-axi ping --ambient");
    expect(claude.hooks.SessionStart.length).toBeGreaterThan(0);

    const codex = JSON.parse(await readFile(join(home, ".codex", "hooks.json"), "utf-8"));
    expect(JSON.stringify(codex)).toContain("ping --ambient");

    // codex config.toml must carry the hooks feature flag
    const codexConfig = await readFile(join(home, ".codex", "config.toml"), "utf-8");
    expect(codexConfig).toContain("hooks");

    const plugin = await readFile(join(home, ".config", "opencode", "plugins", "axi-ha-axi.js"), "utf-8");
    expect(plugin).toContain("ha-axi");
    expect(plugin).toContain("ping --ambient");

    // and a follow-up --check reports OK
    const check = await envelope(["hooks", "--check"], home);
    expect(check.doc.code).toBe("OK");
  });

  it("is idempotent across repeated installs and stays OK on --check", async () => {
    const home = await tempHome();
    await envelope(["hooks"], home);
    const first = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf-8"));
    await envelope(["hooks"], home);
    const second = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf-8"));
    expect(second).toEqual(first);
    const check = await envelope(["hooks", "--check"], home);
    expect(check.doc.code).toBe("OK");
  });

  it("refuses to clobber an unmanaged opencode plugin", async () => {
    const home = await tempHome();
    const pluginDir = join(home, ".config", "opencode", "plugins");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "axi-ha-axi.js"), "// my own plugin\n", "utf-8");
    const { status, stdout } = await runCli(["setup", "hooks"], { homeDir: home });
    expect(status).not.toBe(0);
    expect(stdout).toContain("unmanaged OpenCode plugin");
    expect(await readFile(join(pluginDir, "axi-ha-axi.js"), "utf-8")).toBe("// my own plugin\n");
  });

  it("rejects unknown subcommands and flags", async () => {
    const home = await tempHome();
    const badSub = await runCli(["setup", "bogus"], { homeDir: home });
    expect(badSub.status).toBe(2);
    expect(badSub.stdout).toContain("Unknown setup subcommand");
    const badFlag = await runCli(["setup", "hooks", "--force"], { homeDir: home });
    expect(badFlag.status).toBe(2);
    expect(badFlag.stdout).toContain("Unknown flag");
  });
});
