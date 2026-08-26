// Service noun slice (#13): `service list` (curated idempotency metadata)
// and `service call` — v1's only mutating verb, carrying the project's
// entire safety posture (ADR 0001).
import { AxiError } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { resolveConfig, type GlobalFlags } from "./config.js";
import { HaClient } from "./ha.js";
import { GATED_DOMAINS, isIdempotentService } from "./safety.js";
import { renderHelp, renderList, truncate, type Row } from "./toon.js";

// ---------- shared parsing ----------

type CallSpec = {
  domain: string;
  service: string;
  /** Explicit concrete target ids (--entity flag and/or entity_id data key). */
  targets: string[];
  data: Row;
  area?: string;
  device?: string;
  all?: boolean;
  dryRun: boolean;
  iMeanAll: boolean;
};

const CALL_USAGE = [
  "usage: ha-axi service call <domain.service> [--entity <id,id,...>] [key=value ...] [--dry-run]",
  "example: ha-axi service call light.turn_on --entity light.kitchen brightness=80",
];

function parseServiceName(arg: string | undefined): { domain: string; service: string } {
  if (!arg) {
    throw new AxiError("Missing service name", "VALIDATION_ERROR", CALL_USAGE);
  }
  const dot = arg.indexOf(".");
  if (dot <= 0 || dot === arg.length - 1) {
    throw new AxiError(`Invalid service name: ${arg} (expected <domain>.<service>)`, "VALIDATION_ERROR", [
      ...CALL_USAGE,
      "run `ha-axi service list --domain <d>` to discover services",
    ]);
  }
  return { domain: arg.slice(0, dot), service: arg.slice(dot + 1) };
}

/** Data value coercion: numeric strings → number, true/false → boolean, else string. */
export function coerceDataValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseCall(args: string[]): CallSpec {
  const { domain, service } = parseServiceName(args[0]);
  const spec: CallSpec = { domain, service, targets: [], data: {}, dryRun: false, iMeanAll: false };
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      spec.dryRun = true;
    } else if (arg === "--i-mean-all") {
      spec.iMeanAll = true;
    } else if (arg.startsWith("--entity=")) {
      addTargets(spec, arg.slice("--entity=".length));
    } else if (arg === "--entity") {
      i += 1;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new AxiError("Flag --entity requires a value", "VALIDATION_ERROR", CALL_USAGE);
      }
      addTargets(spec, args[i]);
    } else if (arg.startsWith("--area=")) {
      spec.area = arg.slice(7);
    } else if (arg === "--area") {
      spec.area = args[++i];
    } else if (arg.startsWith("--device=")) {
      spec.device = arg.slice("--device=".length);
    } else if (arg === "--device") {
      spec.device = args[++i];
    } else if (arg === "--all") {
      spec.all = true;
    } else if (arg.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", CALL_USAGE);
    } else {
      positionals.push(arg);
    }
  }
  // Positional data pairs k=v; repeated keys: last wins (contract #13).
  for (const pair of positionals) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new AxiError(`Invalid data argument: ${pair} (expected key=value)`, "VALIDATION_ERROR", CALL_USAGE);
    }
    const key = pair.slice(0, eq);
    const value = coerceDataValue(pair.slice(eq + 1));
    if (key === "entity_id") {
      addTargets(spec, String(value));
    } else {
      spec.data[key] = value;
    }
  }
  return spec;
}

function addTargets(spec: CallSpec, raw: string): void {
  for (const id of raw.split(",")) {
    const trimmed = id.trim();
    if (trimmed) spec.targets.push(trimmed);
  }
}

// ---------- commands ----------

export async function serviceCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb === "list") return serviceList(rest, ctx);
  if (verb === "call") return serviceCall(rest, ctx);
  throw new AxiError(
    verb ? `Unknown service command: ${verb}` : "Missing service subcommand",
    "VALIDATION_ERROR",
    ["usage: ha-axi service list [--domain <d>]", ...CALL_USAGE],
  );
}
type HaDomainEntry = { domain: string; services?: Record<string, HaServiceEntry> };
type HaServiceEntry = { description?: string };

async function serviceList(args: string[], ctx?: GlobalFlags): Promise<string> {
  let domain: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--domain=")) {
      domain = arg.slice(9);
    } else if (arg === "--domain") {
      i += 1;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new AxiError("Flag --domain requires a value", "VALIDATION_ERROR", [
          "usage: ha-axi service list [--domain <d>]",
        ]);
      }
      domain = args[i];
    } else if (arg.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
        "usage: ha-axi service list [--domain <d>]",
      ]);
    } else {
      throw new AxiError(`Unexpected argument: ${arg}`, "VALIDATION_ERROR", [
        "usage: ha-axi service list [--domain <d>]",
      ]);
    }
  }

  const cfg = await resolveConfig(ctx ?? {});
  const ha = new HaClient(cfg);
  const domains = (await ha.get("/api/services")) as HaDomainEntry[];

  const entries: Array<{ domain: string; name: string; entry: HaServiceEntry }> = [];
  for (const d of domains) {
    if (domain && d.domain !== domain) continue;
    for (const [name, entry] of Object.entries(d.services ?? {})) {
      entries.push({ domain: d.domain, name, entry });
    }
  }

  // Empty results are definitive: count 0 + note + hint, exit 0.
  if (entries.length === 0) {
    return `${encode({
      count: 0,
      note: domain ? `no services in domain '${domain}'` : "no services exposed",
      hint: "run without --domain to see all domains",
    })}\n`;
  }

  const rows: Row[] = entries.map((e) => ({
    service: domain ? e.name : `${e.domain}.${e.name}`,
    idempotent: isIdempotentService(e.name),
    desc: truncate(e.entry.description ?? ""),
  }));
  const example = entries[0];
  return `${encode({ count: rows.length })}\n---\n${renderList("services", rows)}\n${renderHelp([
    `service call ${example.domain}.${example.name} --entity <id>`,
  ])}\n`;
}


async function serviceCall(args: string[], ctx?: GlobalFlags): Promise<string> {
  const spec = parseCall(args);

  // GATED DOMAINS FIRST (ADR 0001) — before any network activity, before any
  // other check, with no bypass path whatsoever.
  if (GATED_DOMAINS[spec.domain]) {
    throw new AxiError(
      `"${spec.domain}" is a gated domain; ha-axi refuses mutations to it`,
      "DOMAIN_EXCLUDED",
      [`check state read-only: entity get ${spec.domain}.<id>`],
    );
  }

  // Non-concrete targets refused (contract safety posture). A literal
  // "all" target, area/device targeting, or no explicit target at all is
  // bulk by definition; --i-mean-all is the single explicit override.
  const bulkReason = bulkTargetRefusal(spec);
  if (bulkReason && !spec.iMeanAll) {
    throw new AxiError(bulkReason.message, "BULK_TARGET_REFUSED", [
      "--i-mean-all to proceed deliberately",
      `entity list --domain ${spec.domain} to discover concrete ids`,
    ]);
  }

  if (spec.targets.length > 0 && spec.all && !spec.iMeanAll) {
    // --all alongside concrete ids is contradictory; treat as refusal.
    throw new AxiError(
      "Refusing mixed targeting: --all plus explicit ids",
      "BULK_TARGET_REFUSED",
      ["pass either --all or --entity ids, not both"],
    );
  }

  const body: Row = { ...spec.data };
  if (spec.targets.length > 0) body.entity_id = spec.targets;

  if (spec.dryRun) {
    // Print the exact request; NOTHING is sent, exit 0.
    return `${encode({
      dry_run: true,
      service: `${spec.domain}.${spec.service}`,
      target: spec.targets,
      data: spec.data,
    })}\n${renderHelp(["re-run without --dry-run to fire"])}\n`;
  }

  const cfg = await resolveConfig(ctx ?? {});
  const ha = new HaClient(cfg);
  const result = await ha.post(
    `/api/services/${encodeURIComponent(spec.domain)}/${encodeURIComponent(spec.service)}`,
    body,
  );

  const changed = Array.isArray(result) ? result : [];
  const rows: Row[] = changed
    .filter((s): s is { entity_id: string; state: string } => !!s && typeof s === "object")
    .map((s) => ({ id: String(s.entity_id), state: String(s.state) }));
  let out = encode({ changed: rows.length });
  if (rows.length > 0) out += `\n---\n${renderList("states", rows)}`;
  const firstId = rows[0]?.id ?? spec.targets[0];
  return `${out}\n${renderHelp(firstId ? [`entity get ${firstId} to verify`] : ["ha-axi entity list to verify"])}\n`;
}

/** Returns the refusal reason for a non-concrete target, or null when concrete. */
function bulkTargetRefusal(spec: CallSpec): { message: string } | null {
  if (spec.all) return { message: "Refusing bulk target: --all" };
  if (spec.area) return { message: `Refusing non-concrete target: area '${spec.area}'` };
  if (spec.device) return { message: `Refusing non-concrete target: device '${spec.device}'` };
  if (spec.targets.includes("all")) return { message: 'Refusing bulk target: entity_id "all"' };
  if (spec.targets.length === 0) {
    return { message: "Refusing mutation without an explicit entity target" };
  }
  return null;
}
