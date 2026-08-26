import { AxiError, runAxiCli } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { VERSION } from "./version.js";
import { resolveConfig, type GlobalFlags, type ResolvedConfig } from "./config.js";
import { HaClient } from "./ha.js";
import { renderHelp } from "./toon.js";

export const DESCRIPTION = "Agent control for Home Assistant without an MCP server";

// Planned commands are advertised up front so agents can discover the surface;
// each carries a "(planned)" marker until its slice lands.
export const TOP_HELP = encode({
  usage: "ha-axi <command> [args] [flags]",
  description: DESCRIPTION,
  commands: {
    ping: "Liveness + auth probe (`{ok, profile, version, latency_ms}`)",
    entity: "(planned) List and inspect entities",
    service: "(planned) List services; call them behind safety gates",
    template: "(planned) Render a Jinja2 template server-side",
    history: "(planned) State timelines per entity",
    logbook: "(planned) Human-readable event stream",
    area: "(planned) Area registry reads over the WS bridge",
    device: "(planned) Device registry reads over the WS bridge",
    statistics: "(planned) Recorder statistics over the WS bridge",
  },
  flags: {
    "--profile, -p": "Named connection profile from the config file",
    "--url": "Override Home Assistant URL",
    "--token": "Override long-lived access token",
    "--help": "Show help for a command",
    "--version": "Show version",
  },
  examples: ["ha-axi ping", "ha-axi -p bench ping"],
});

const PLANNED_COMMANDS: Record<string, true> = {
  entity: true,
  service: true,
  template: true,
  history: true,
  logbook: true,
  area: true,
  device: true,
  statistics: true,
};

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
  if (args.length > 0) {
    throw new AxiError(`Unexpected argument: ${args[0]}`, "VALIDATION_ERROR", [
      "Run `ha-axi ping --help` for usage",
    ]);
  }
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

function plannedCommand(name: string): () => never {
  return () => {
    throw new AxiError(`${name} is not implemented yet`, "UNKNOWN", [
      "this verb lands in a later slice",
      "run `ha-axi ping` to verify connectivity meanwhile",
    ]);
  };
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
        ...Object.fromEntries(
          Object.keys(PLANNED_COMMANDS).map((name) => [name, plannedCommand(name)]),
        ),
      },
      home: async () => TOP_HELP,
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
