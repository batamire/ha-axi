import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { AxiError } from "axi-sdk-js";

const execFileP = promisify(execFile);

export type GlobalFlags = {
  profile?: string;
  url?: string;
  token?: string;
  verbose?: boolean;
};

export type ResolvedConfig = {
  /** First candidate; kept for callers that predate ordered URLs. */
  url: string;
  /** Ordered connection candidates, tried left to right (`urls[0] === url`). */
  urls: string[];
  token: string;
  profile: string;
  timeoutMs: number;
  insecure: boolean;
  /** Trace candidate selection to stderr even when the first one answers. */
  verbose: boolean;
};

type Profile = {
  url?: string;
  urls?: unknown;
  token?: string;
  token_cmd?: string;
  timeout?: number;
  insecure?: boolean;
};

type ConfigFile = { profiles?: Record<string, Profile> };

export function configPath(homeDir?: string): string {
  const base = process.env.XDG_CONFIG_HOME || join(homeDir ?? homedir(), ".config");
  return join(base, "ha-axi", "config.toml");
}

/** Warn once if the config file is group/world readable. */
async function warnIfLoosePerms(path: string): Promise<void> {
  try {
    const st = await stat(path);
    // eslint-disable-next-line no-bitwise -- permission mask check
    if ((st.mode & 0o077) !== 0) {
      process.stderr.write(`warning: ${path} is readable by group/others; run chmod 600 on it\n`);
    }
  } catch {
    // missing file is fine
  }
}

async function readConfigFile(homeDir?: string): Promise<ConfigFile> {
  const path = configPath(homeDir);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    return {};
  }
  await warnIfLoosePerms(path);
  try {
    return parse(text) as ConfigFile;
  } catch (e) {
    throw new AxiError(`Failed to parse ${path}: ${(e as Error).message}`, "VALIDATION_ERROR", [
      "fix the TOML syntax in the config file",
    ]);
  }
}

function pickDefaultProfileName(profiles: Record<string, Profile>): string | undefined {
  if ("default" in profiles) return "default";
  return Object.keys(profiles)[0];
}

/** Execute a `token_cmd` and trim its stdout into the token. Never logged. */
async function tokenFromCmd(cmd: string): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, { shell: true });
    const token = stdout.trim();
    if (!token) throw new Error("empty output");
    return token;
  } catch (e) {
    throw new AxiError(
      `token_cmd failed: ${(e as Error).message.split("\n")[0]}`,
      "AUTH_MISSING",
      ["check that the token_cmd runs non-interactively"],
    );
  }
}

/**
 * Credential resolution, per contract #6:
 * flags > HASS_URL/HASS_TOKEN env > config profiles (--profile/-p; default =
 * profile named `default` or the first defined) > stdin token.
 */
export async function resolveConfig(
  flags: GlobalFlags,
  opts: { homeDir?: string; stdin?: string } = {},
): Promise<ResolvedConfig> {
  const cfgFile = await readConfigFile(opts.homeDir);
  const profiles = cfgFile.profiles ?? {};

  const profileName = flags.profile ?? pickDefaultProfileName(profiles) ?? "default";
  const profile = profiles[profileName];

  const urls = collectUrls(flags.url, envValue("HASS_URLS"), envValue("HASS_URL"), profile, profileName);
  if (urls.length === 0 && !profile) {
    throw new AxiError("No Home Assistant connection configured", "AUTH_MISSING", [
      "set HASS_URL and HASS_TOKEN",
      `or add [profiles.${profileName}] with url/token to ${configPath(opts.homeDir)}`,
    ]);
  }
  let token = flags.token ?? envValue("HASS_TOKEN") ?? profile?.token;
  if (!token && profile?.token_cmd) token = await tokenFromCmd(profile.token_cmd);
  // Last resort: a piped stdin token (prompt-free — agents cannot answer
  // interactive prompts, so this only fires when stdin was piped explicitly).
  if (!token && !process.stdin.isTTY) {
    const piped = opts.stdin !== undefined ? opts.stdin : await readStdin();
    if (piped?.trim()) token = piped.trim();
  }

  if (urls.length === 0) {
    throw new AxiError(`No url for profile '${profileName}'`, "VALIDATION_ERROR", [
      `set url or urls in [profiles.${profileName}] or pass --url`,
    ]);
  }
  if (!token) {
    throw new AxiError(`No token for profile '${profileName}'`, "AUTH_MISSING", [
      "set HASS_TOKEN",
      `or set token/token_cmd in [profiles.${profileName}]`,
      "or pipe a long-lived access token via stdin",
    ]);
  }

  const insecure = profile?.insecure === true;
  if (insecure) {
    // One-shot CLI process: disabling verification process-wide is safe here.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    process.stderr.write(`warning: TLS verification disabled (profile: ${profileName})\n`);
  }

  return {
    url: urls[0],
    urls,
    token,
    profile: profileName,
    timeoutMs: (profile?.timeout ?? 30) * 1000,
    insecure,
    verbose: flags.verbose === true,
  };
}

/** Ordered candidates for a resolved config; tolerates pre-`urls` callers. */
export function urlCandidates(cfg: Pick<ResolvedConfig, "url" | "urls">): string[] {
  return Array.isArray(cfg.urls) && cfg.urls.length > 0 ? cfg.urls : [cfg.url];
}

/**
 * Candidate precedence mirrors credential resolution: `--url` > `HASS_URLS` >
 * `HASS_URL` > profile `urls` > profile `url`. `urls` (when non-empty) wins
 * over a legacy single `url`. Candidates are trimmed, de-slashed, and deduped;
 * the first candidate that answers wins, all sharing the profile's one token.
 */
function collectUrls(
  flagUrl: string | undefined,
  envUrls: string | undefined,
  envUrl: string | undefined,
  profile: Profile | undefined,
  profileName: string,
): string[] {
  const envList = envUrls ? splitList(envUrls) : [];
  // Overrides win outright; the profile is only inspected (and validated) when
  // none of them supplied a candidate, so `--url` can bypass a stale entry.
  let raw: string[] | undefined =
    flagUrl ? [flagUrl] : envList.length > 0 ? envList : envUrl ? [envUrl] : undefined;
  if (!raw && profile?.urls !== undefined) {
    const list = profileUrlList(profile.urls, profileName).filter((u) => u.trim() !== "");
    raw = list.length > 0 ? list : undefined;
  }
  if (!raw && profile?.url) raw = [profile.url];

  const out: string[] = [];
  for (const candidate of raw ?? []) {
    const normalized = candidate.trim().replace(/\/+$/, "");
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** `HASS_URLS` is a comma-separated list; empty entries are ignored. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function profileUrlList(value: unknown, profileName: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new AxiError(
      `urls for profile '${profileName}' must be an array of URL strings`,
      "VALIDATION_ERROR",
      ['use urls = ["https://primary.example", "https://fallback.example"]'],
    );
  }
  return value as string[];
}

/** Env lookup treating unset and empty-string the same. */
function envValue(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

async function readStdin(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}
