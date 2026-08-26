// Entity noun slice (#12): curated inventory (`entity list`) and single-entity
// detail (`entity get`). Shapes follow the #5 prototype exactly.
import { encode } from "@toon-format/toon";
import { AxiError } from "axi-sdk-js";
import { resolveConfig, type GlobalFlags } from "./config.js";
import { HaClient } from "./ha.js";
import { wsCall } from "./ws.js";
import { relTime, renderHelp, renderList, truncate, type Row } from "./toon.js";

type HaState = {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
};

type EntityFlags = {
  all: boolean;
  counts: boolean;
  full: boolean;
  domain?: string;
  area?: string;
  query?: string;
};

const BOOL_FLAGS: Record<string, boolean> = { "--all": true, "--counts": true, "--full": true };
const VALUE_FLAGS: Record<string, boolean> = { "--domain": true, "--area": true, "--query": true };

const LIST_USAGE = [
  "usage: ha-axi entity list [--all] [--counts] [--full] [--domain <d>] [--area <name>] [--query <text>]",
  "usage: ha-axi entity get <id> [--full]",
];

/** Parse `entity list` flags (spaced and `=` forms; booleans take no value). */
export function parseEntityListFlags(args: string[]): EntityFlags {
  const flags: EntityFlags = { all: false, counts: false, full: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOL_FLAGS[name] === true) {
      if (eq !== -1) throw new AxiError(`${name} takes no value`, "VALIDATION_ERROR", LIST_USAGE);
      if (name === "--all") flags.all = true;
      else if (name === "--counts") flags.counts = true;
      else flags.full = true;
      continue;
    }
    if (VALUE_FLAGS[name] === true) {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined) {
        throw new AxiError(`Missing value for ${name}`, "VALIDATION_ERROR", LIST_USAGE);
      }
      if (name === "--domain") flags.domain = value.toLowerCase();
      else if (name === "--area") flags.area = value;
      else flags.query = value;
      continue;
    }
    const message = name.startsWith("-") ? `Unknown flag: ${arg}` : `Unexpected argument: ${arg}`;
    throw new AxiError(message, "VALIDATION_ERROR", LIST_USAGE);
  }
  return flags;
}

function domainOf(entityId: string): string {
  return entityId.split(".")[0] ?? "";
}

const UNAVAILABLE_STATES: Record<string, boolean> = { unavailable: true, unknown: true };
const CURATED_CATEGORIES: Record<string, boolean> = { config: true, diagnostic: true };

function isUnavailableState(s: HaState): boolean {
  return UNAVAILABLE_STATES[s.state] === true;
}

function isCuratedOut(s: HaState): boolean {
  return CURATED_CATEGORIES[String(s.attributes?.entity_category ?? "")] === true;
}

function entityName(s: HaState): string {
  const n = s.attributes?.friendly_name;
  return typeof n === "string" && n.length > 0 ? n : s.entity_id;
}

async function fetchStates(ha: HaClient): Promise<HaState[]> {
  const states = await ha.get("/api/states");
  if (!Array.isArray(states)) {
    throw new AxiError("Unexpected /api/states response shape", "UPSTREAM_ERROR", []);
  }
  return states as HaState[];
}

// ---------- area resolution over the one-shot WS bridge ----------

type AreaIndex = {
  nameByEntity: Map<string, string>;
  areaIdByEntity: Map<string, string>;
  nameByAreaId: Map<string, string>;
};

/**
 * Resolve entity -> area via the WS registries: an entity's own area_id wins,
 * otherwise it inherits its device's area_id (contract #12).
 */
async function resolveAreaIndex(cfg: Awaited<ReturnType<typeof resolveConfig>>): Promise<AreaIndex> {
  const [areasRaw, devicesRaw, entitiesRaw] = await Promise.all([
    wsCall(cfg, "config/area_registry/list"),
    wsCall(cfg, "config/device_registry/list"),
    wsCall(cfg, "config/entity_registry/list"),
  ]);
  const areas = registryRows(areasRaw);
  const devices = registryRows(devicesRaw);
  const entities = registryRows(entitiesRaw);

  const nameByAreaId = new Map<string, string>();
  for (const a of areas) {
    const areaId = str(a["area_id"]);
    if (areaId) nameByAreaId.set(areaId, str(a["name"]) ?? areaId);
  }
  const areaIdByDevice = new Map<string, string>();
  for (const d of devices) {
    const id = str(d["id"]);
    const areaId = str(d["area_id"]);
    if (id && areaId) areaIdByDevice.set(id, areaId);
  }
  const nameByEntity = new Map<string, string>();
  const areaIdByEntity = new Map<string, string>();
  for (const e of entities) {
    const entityId = str(e["entity_id"]);
    if (!entityId) continue;
    const ownAreaId = str(e["area_id"]);
    const deviceAreaId = areaIdByDevice.get(str(e["device_id"]) ?? "");
    const areaId = ownAreaId ?? deviceAreaId;
    if (!areaId) continue;
    areaIdByEntity.set(entityId, areaId);
    const name = nameByAreaId.get(areaId);
    if (name) nameByEntity.set(entityId, name);
  }
  return { nameByEntity, areaIdByEntity, nameByAreaId };
}

/** Registry rows arrive as a JSON array of flat objects over the bridge. */
function registryRows(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) {
    throw new AxiError("Unexpected registry response from the WS bridge", "UPSTREAM_ERROR", []);
  }
  return v as Array<Record<string, unknown>>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ---------- attribute shaping ----------

/** Scalars pass through (truncated); arrays/objects elided to `<type>[N]`. */
function attrValue(v: unknown, full: boolean): unknown {
  if (Array.isArray(v)) {
    return full ? v : v.length === 0 ? [] : `array[${v.length}] — use --full`;
  }
  if (typeof v === "object" && v !== null) {
    const n = Object.keys(v).length;
    return full ? v : n === 0 ? {} : `object[${n}] — use --full`;
  }
  return truncate(v); // the >8000-char rule applies per value, --full included
}

/** Scalar-only attrs block; `friendly_name` is surfaced as `name` instead. */
function attrsBlock(attrs: Record<string, unknown>, full: boolean): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "friendly_name") continue;
    out[k] = attrValue(v, full);
  }
  return out;
}

const SWITCHABLE_DOMAINS: Record<string, boolean> = {
  light: true,
  switch: true,
  fan: true,
  media_player: true,
  humidifier: true,
  input_boolean: true,
  siren: true,
  water_heater: true,
};
const GATED_DOMAINS: Record<string, boolean> = {
  lock: true,
  alarm_control_panel: true,
  cover: true,
};

/** Next-step service suggestion mirroring the #5 prototype's entity-get help. */
export function suggestService(domain: string, entityId: string): string {
  if (SWITCHABLE_DOMAINS[domain] === true) return `service call ${domain}.turn_on --entity ${entityId}`;
  if (domain === "climate") return `service call climate.set_temperature --entity ${entityId}`;
  if (GATED_DOMAINS[domain] === true) {
    return `"${domain}" is a gated domain; mutations to it are refused client-side`;
  }
  return `service list --domain ${domain} to discover services`;
}

// ---------- commands ----------

export async function entityCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb === "list") return entityList(rest, ctx);
  if (verb === "get") return entityGet(rest, ctx);
  throw new AxiError(
    verb ? `Unknown entity command: ${verb}` : "Missing entity subcommand",
    "VALIDATION_ERROR",
    LIST_USAGE,
  );
}

function truncateRow(row: Row, full: boolean): Row {
  if (full) return row;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, truncate(v)]));
}

function emptyNote(flags: EntityFlags): string {
  const parts: string[] = [];
  if (flags.query) parts.push(`'${flags.query}'`);
  if (flags.domain) parts.push(`domain '${flags.domain}'`);
  if (flags.area) parts.push(`area '${flags.area}'`);
  return parts.length > 0 ? `no entities match ${parts.join(" + ")}` : "no entities to list";
}

async function entityList(args: string[], ctx?: GlobalFlags): Promise<string> {
  const flags = parseEntityListFlags(args);
  const cfg = await resolveConfig(ctx ?? {});
  const ha = new HaClient(cfg);
  const states = await fetchStates(ha);
  const total = states.length;

  // Curated default hides config/diagnostic entities AND unavailable/unknown
  // states; --all disables both exclusions.
  let visible = flags.all ? [...states] : states.filter((s) => !isCuratedOut(s) && !isUnavailableState(s));
  const hiddenCount = (n: number) => `${n} entit${n === 1 ? "y" : "ies"} hidden by curated view; retry with --all`;

  if (flags.query) {
    const q = flags.query.toLowerCase();
    visible = visible.filter(
      (s) => s.entity_id.toLowerCase().includes(q) || entityName(s).toLowerCase().includes(q),
    );
  }
  if (flags.domain) {
    visible = visible.filter((s) => domainOf(s.entity_id) === flags.domain);
  }
  if (flags.area) {
    const idx = await resolveAreaIndex(cfg);
    const want = flags.area.toLowerCase();
    visible = visible.filter((s) => {
      const areaId = idx.areaIdByEntity.get(s.entity_id);
      if (areaId === undefined) return false;
      return areaId.toLowerCase() === want || idx.nameByAreaId.get(areaId)?.toLowerCase() === want;
    });
  }

  // Empty results are definitive: count 0 + note + retry hint, exit 0.
  if (visible.length === 0) {
    const hint =
      !flags.all && states.some((s) => isUnavailableState(s) || isCuratedOut(s))
        ? hiddenCount(states.filter((s) => isUnavailableState(s) || isCuratedOut(s)).length)
        : "retry with fewer filters";
    return `${encode({ count: 0, note: emptyNote(flags), hint })}\n`;
  }

  const rows = visible.map((s) =>
    truncateRow(
      {
        id: s.entity_id,
        name: entityName(s),
        state: s.state,
        changed: s.last_changed ? relTime(s.last_changed) : "?",
      },
      flags.full,
    ),
  );

  // Aggregates ALWAYS span the full fetched set, not the filtered/curation view.
  let out = `${encode({ count: `${visible.length} of ${total} total` })}`;
  if (!flags.all) {
    out += `\n${encode({ unavailable: `${states.filter(isUnavailableState).length} hidden` })}`;
  }
  out += `\n---\n${renderList("entities", rows)}`;
  if (flags.counts) {
    const domainCounts: Row = {};
    for (const s of states) {
      const d = domainOf(s.entity_id);
      domainCounts[d] = ((domainCounts[d] as number) ?? 0) + 1;
    }
    out += `\n---\n${encode({ domain: domainCounts })}`;
  }
  return `${out}\n${renderHelp(["entity get <id> for detail", "entity list --full for complete fields"])}\n`;
}

async function entityGet(args: string[], ctx?: GlobalFlags): Promise<string> {
  let full = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--full" || arg.startsWith("--full=")) {
      full = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
        "usage: ha-axi entity get <id> [--full]",
        "example: ha-axi entity get light.kitchen",
      ]);
    }
    positional.push(arg);
  }
  if (positional.length === 0) {
    throw new AxiError("Missing entity id", "VALIDATION_ERROR", [
      "usage: ha-axi entity get <id> [--full]",
      "example: ha-axi entity get light.kitchen",
    ]);
  }
  if (positional.length > 1) {
    throw new AxiError(`Unexpected argument: ${positional[1]}`, "VALIDATION_ERROR", [
      "usage: ha-axi entity get <id> [--full]",
    ]);
  }
  const id = positional[0];

  const cfg = await resolveConfig(ctx ?? {});
  const ha = new HaClient(cfg);
  const state = (await ha.get(`/api/states/${encodeURIComponent(id)}`)) as HaState | null;
  if (!state || typeof state.entity_id !== "string") {
    throw new AxiError(`Unknown entity: ${id}`, "NOT_FOUND", ["run `ha-axi entity list` to see available ids"]);
  }

  const idx = await resolveAreaIndex(cfg);
  const detail: Row = {
    id: state.entity_id,
    name: entityName(state),
    state: state.state,
    area: idx.nameByEntity.get(state.entity_id) ?? null,
    changed: state.last_changed ? relTime(state.last_changed) : "?",
    attrs: attrsBlock(state.attributes ?? {}, full),
  };
  return `${encode(detail)}\n${renderHelp([suggestService(domainOf(state.entity_id), state.entity_id)])}\n`;
}
