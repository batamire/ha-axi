import { AxiError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { VERSION } from "./version.js";
import { resolveConfig, type GlobalFlags, type ResolvedConfig } from "./config.js";
import { HaClient } from "./ha.js";
import { renderHelp } from "./toon.js";
import { entityCommand } from "./entity.js";
import { serviceCommand } from "./service.js";
import { templateCommand, historyCommand, logbookCommand } from "./reads.js";
import { areaCommand, deviceCommand, statisticsCommand } from "./bridge.js";
import { buildDashboard } from "./dashboard.js";
import { setupCommand } from "./setup.js";

export const DESCRIPTION = "Agent control for Home Assistant without an MCP server";

// Commands are advertised up front so agents can discover the surface.
// Single source of truth for the advertised command surface; src/skill.ts
// derives the SKILL.md command table from this map.
export const COMMAND_SUMMARY: Record<string, string> = {
  ping: "Liveness + auth probe (`{ok, profile, version, latency_ms}`)",
  entity: "List and inspect entities (`list`, `get`)",
  service: "List services; call them behind safety gates (`list`, `call`)",
  template: "Render a Jinja2 template server-side (`render`)",
  history: "State timelines per entity (`get`)",
  logbook: "Human-readable event stream (`get`)",
  area: "Area registry reads over the WS bridge (`list`, `get`)",
  device: "Device registry reads over the WS bridge (`list`)",
  statistics: "Recorder statistic discovery + summaries (`ids`, `get`)",
  setup: "Install ambient SessionStart hooks for Claude/Codex/OpenCode (`hooks`)",
};

export const TOP_HELP = encode({
  usage: "ha-axi <command> [args] [flags]",
  description: DESCRIPTION,
  commands: COMMAND_SUMMARY,
  flags: {
    "--profile, -p": "Named connection profile from the config file",
    "--url": "Override Home Assistant URL",
    "--token": "Override long-lived access token",
    "--help": "Show help for a command",
    "--version": "Show version",
  },
  examples: ["ha-axi ping", "ha-axi -p bench ping", "ha-axi entity list"],
});


export type ParsedArgs = { flags: GlobalFlags; rest: string[] };

/** Split global flags (--profile/-p/--url/--token, both spaced and = forms). */
export function parseGlobalFlags(args: string[]): ParsedArgs {
  const flags: GlobalFlags = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const takesValue = name === "--profile" || name === "-p" || name === "--url" || name === "--token";
    if (!takesValue) {
      rest.push(arg);
      continue;
    }
    const value = inlineValue ?? args[++i];
    if (value === undefined) throw new AxiError(`Missing value for ${name}`, "VALIDATION_ERROR", []);
    if (name === "--profile" || name === "-p") flags.profile = value;
    else if (name === "--url") flags.url = value;
    else flags.token = value;
  }
  return { flags, rest };
}


async function pingCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const ambient = args.includes("--ambient");
  const rest = args.filter((a) => a !== "--ambient");
  if (rest.length > 0) {
    throw new AxiError(`Unexpected argument: ${rest[0]}`, "VALIDATION_ERROR", [
      "Run `ha-axi ping --help` for usage",
    ]);
  }
  if (ambient) return ambientPing(ctx);

  const cfg: ResolvedConfig = await resolveConfig(ctx ?? {});
  const ha = new HaClient(cfg);
  const startedAt = Date.now();
  await ha.get("/api/");
  const config = (await ha.get("/api/config")) as { version?: unknown } | null;
  const version = typeof config?.version === "string" ? config.version : "unknown";
  return (
    encode({
      ok: true,
      profile: cfg.profile,
      version,
      latency_ms: Date.now() - startedAt,
    }) +
    "\n" +
    renderHelp(["entity list for inventory"])
  );
}

/**
 * Hook payload (`ha-axi ping --ambient`, installed by `setup hooks`): one
 * ambient line on success, one `[ha-axi] unreachable` line on any failure.
 * Always exits 0 — NEVER blocks a session start.
 */
async function ambientPing(ctx?: GlobalFlags): Promise<string> {
  try {
    const cfg = await resolveConfig(ctx ?? {});
    const ha = new HaClient(cfg);
    const startedAt = Date.now();
    await ha.get("/api/");
    const config = (await ha.get("/api/config")) as { version?: unknown } | null;
    const states = await ha.get("/api/states");
    const count = Array.isArray(states) ? states.length : 0;
    const version = typeof config?.version === "string" ? config.version : "unknown";
    return `[ha-axi] ${cfg.profile} up · v${version} · ${count} entities · ${Date.now() - startedAt}ms`;
  } catch {
    return "[ha-axi] unreachable";
  }
}


/** Commands receive args with global flags already stripped. */
function withStrippedFlags(
  handler: (args: string[], ctx?: GlobalFlags) => Promise<string>,
): (args: string[], ctx?: GlobalFlags) => Promise<string> {
  return (args, ctx) => handler(parseGlobalFlags(args).rest, ctx);
}

function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    const code = error.code;
    const finalExit = code === "VALIDATION_ERROR" || code === "AUTH_MISSING" ? 2 : 1;
    const obj: Record<string, unknown> = { error: error.message, code };
    if (error.suggestions.length > 0) obj.help = error.suggestions;
    return { output: `${encode(obj)}\n`, exitCode: finalExit };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { output: `${encode({ error: message, code: "UNKNOWN" })}\n`, exitCode: 1 };
}

export async function main(): Promise<void> {
  try {
    await runAxiCli<GlobalFlags | undefined>({
      description: DESCRIPTION,
      version: VERSION,
      topLevelHelp: `${TOP_HELP}\n`,
      commands: {
        ping: withStrippedFlags(pingCommand),
        entity: withStrippedFlags(entityCommand),
        service: withStrippedFlags(serviceCommand),
        template: withStrippedFlags(templateCommand),
        history: withStrippedFlags(historyCommand),
        logbook: withStrippedFlags(logbookCommand),
        area: withStrippedFlags(areaCommand),
        device: withStrippedFlags(deviceCommand),
        statistics: withStrippedFlags(statisticsCommand),
        setup: withStrippedFlags(setupCommand),
      },
      home: async (_args, ctx?: GlobalFlags) => buildDashboard(ctx ?? {}),
      getCommandHelp: () => null,
      formatError,
      resolveContext: ({ args }) => parseGlobalFlags(args).flags,
    });
  } catch (error) {
    const { output, exitCode } = formatError(error);
    process.stdout.write(output);
    process.exitCode = exitCode;
  }
}
