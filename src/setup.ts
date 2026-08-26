import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { encode } from "@toon-format/toon";
import {
  AxiError,
  computeCodexConfigUpdate,
  computeSessionStartHookUpdate,
} from "axi-sdk-js";

export const SETUP_HELP = encode({
  command: "setup",
  description: "Manage ha-axi setup including ambient hooks",
  usage: "ha-axi setup <subcommand> [flags]",
  subcommands: {
    hooks: "Install ambient SessionStart hooks for Claude/Codex/OpenCode",
  },
  flags: {
    "--check": "Verify installed hooks vs expected (report OK or DRIFT)",
    "--help": "Show help",
  },
  examples: ["ha-axi setup hooks", "ha-axi setup hooks --check"],
});

const MARKER = "ha-axi";
const HOOK_TIMEOUT_SECONDS = 10;
/** The hook payload: ping only, one ambient line, never blocks a session. */
const HOOK_COMMAND = "ha-axi ping --ambient";

type Paths = {
  claudeSettings: string;
  codexHooks: string;
  codexConfig: string;
  opencodePlugin: string;
};

function hookPaths(homeDir: string = homedir()): Paths {
  return {
    claudeSettings: join(homeDir, ".claude", "settings.json"),
    codexHooks: join(homeDir, ".codex", "hooks.json"),
    codexConfig: join(homeDir, ".codex", "config.toml"),
    opencodePlugin: join(homeDir, ".config", "opencode", "plugins", `axi-${MARKER}.js`),
  };
}

function hasMarker(path: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf-8").includes(MARKER);
  } catch {
    return false;
  }
}

function checkHooksDrift(
  homeDir?: string,
): { drift: boolean; details: Record<string, unknown> } {
  const paths = hookPaths(homeDir);
  const claudeOk = hasMarker(paths.claudeSettings);
  const codexOk = hasMarker(paths.codexHooks);
  const opencodeOk = hasMarker(paths.opencodePlugin);
  // Codex needs its user-level config.toml to enable the hooks feature.
  let codexConfigOk = false;
  if (existsSync(paths.codexConfig)) {
    try {
      codexConfigOk = readFileSync(paths.codexConfig, "utf-8").includes("hooks");
    } catch {
      codexConfigOk = false;
    }
  }
  const drift = !(claudeOk && codexOk && opencodeOk && codexConfigOk);
  const details: Record<string, unknown> = {
    claude: claudeOk ? "ok" : "missing",
    codex: codexOk ? "ok" : "missing",
    opencode: opencodeOk ? "ok" : "missing",
    codexConfig: codexConfigOk ? "ok" : "missing",
  };
  return { drift, details };
}

/** Shared DRIFT/OK envelope for the --check and post-install paths. */
function hookStatusPayload(drift: boolean, details: Record<string, unknown>): string {
  if (drift) {
    return (
      encode({
        code: "DRIFT",
        status: "drift detected",
        hooks: details,
      }) +
      "\n" +
      encode({
        help: ["Run `ha-axi setup hooks` to reinstall"],
      })
    );
  }
  return (
    encode({
      code: "OK",
      status: "hooks installed",
      hooks: details,
    }) +
    "\n" +
    encode({
      help: ["Run `ha-axi setup hooks --check` to verify"],
    })
  );
}

/** Upsert a JSON hook config via the SDK's managed-marker merge logic. */
function upsertJsonHookFile(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
  const [updated, changed] = computeSessionStartHookUpdate(current, {
    marker: MARKER,
    command: HOOK_COMMAND,
    timeoutSeconds: HOOK_TIMEOUT_SECONDS,
  });
  if (changed) writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
}

// Generated ambient plugin: runs the ping-only hook and injects its single
// line into the OpenCode system prompt. Managed files carry the marker so
// reinstalls can overwrite them but hand-edited ones are never clobbered.
const OPENCODE_PLUGIN_TEMPLATE = `// ha-axi managed opencode plugin: axi-sdk-js SessionStart equivalent
import { spawn } from "node:child_process";

const command = ${JSON.stringify(HOOK_COMMAND)};
const marker = ${JSON.stringify(MARKER)};
const ambientHeader = ${JSON.stringify(`## AXI ambient context: ${MARKER}`)};
const timeoutMs = ${JSON.stringify(HOOK_TIMEOUT_SECONDS * 1000)};

function runAxiHomeView(cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd: typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd(),
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve(marker + " ambient context timed out after " + timeoutMs + "ms");
    }, timeoutMs);

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(marker + " ambient context failed: " + error.message);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      resolve((stderr || stdout || marker + " exited with code " + code).trim());
    });
  });
}

export const haAxi = async ({ directory }) => {
  const sessionCache = new Map();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID ?? "__global__";
      let homeView = sessionCache.get(sessionID);
      if (homeView === undefined) {
        homeView = await runAxiHomeView(directory);
        sessionCache.set(sessionID, homeView);
      }

      if (homeView.length === 0) return;
      output.system.push(ambientHeader + "\\n" + homeView);
    },
  };
};
`;

function installOpenCodePlugin(pluginPath: string): void {
  if (existsSync(pluginPath)) {
    let current = "";
    try {
      current = readFileSync(pluginPath, "utf-8");
    } catch {
      current = "";
    }
    if (!current.includes(MARKER)) {
      throw new AxiError(
        `${pluginPath}: refusing to overwrite unmanaged OpenCode plugin`,
        "VALIDATION_ERROR",
        ["Remove or rename the existing plugin file, then re-run `ha-axi setup hooks`"],
      );
    }
  }
  mkdirSync(join(pluginPath, ".."), { recursive: true });
  writeFileSync(pluginPath, OPENCODE_PLUGIN_TEMPLATE, "utf-8");
}

function installHooks(): string {
  const paths = hookPaths();
  installOpenCodePlugin(paths.opencodePlugin);
  upsertJsonHookFile(paths.claudeSettings);
  upsertJsonHookFile(paths.codexHooks);
  // Codex also needs the user-level feature flag.
  mkdirSync(join(paths.codexConfig, ".."), { recursive: true });
  const currentToml = existsSync(paths.codexConfig)
    ? readFileSync(paths.codexConfig, "utf-8")
    : "";
  const [updatedToml, tomlChanged] = computeCodexConfigUpdate(currentToml);
  if (tomlChanged) writeFileSync(paths.codexConfig, updatedToml, "utf-8");

  const { drift, details } = checkHooksDrift();
  return hookStatusPayload(drift, details);
}

export async function setupCommand(args: string[]): Promise<string> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return SETUP_HELP;
  }
  const sub = args[0];
  if (sub !== "hooks") {
    throw new AxiError(`Unknown setup subcommand: ${sub}`, "VALIDATION_ERROR", [
      "Available: hooks",
      "Run `ha-axi setup --help` for usage",
    ]);
  }
  const rest = args.slice(1);
  for (const flag of rest) {
    if (flag.startsWith("-") && flag !== "--check") {
      throw new AxiError(`Unknown flag: ${flag}`, "VALIDATION_ERROR", [
        "Run `ha-axi setup hooks --help` for usage",
      ]);
    }
  }

  if (rest.includes("--check")) {
    const { drift, details } = checkHooksDrift();
    return hookStatusPayload(drift, details);
  }
  return installHooks();
}
