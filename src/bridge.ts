// Bridge nouns slice (#15): `area list/get`, `device list`, `statistics ids|get`
// over the stateless one-shot WS bridge (contract: ONE request/response pair
// per connection — no subscriptions, no persistent sessions).
//
// Statistics derivation note: there is NO canonical cross-version WS command
// for listing statistic ids (recorder listing commands vary by HA release and
// recorder availability). To stay robust across versions we DERIVE candidates
// client-side from /api/states: a `sensor` entity qualifies when it carries a
// `state_class` attribute or its state parses as a number. This intentionally
// excludes binary_sensor and non-numeric sensors; it is a candidate list, not
// an authoritative recorder inventory.
import { AxiError } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { resolveConfig, type GlobalFlags, type ResolvedConfig } from "./config.js";
import { HaClient } from "./ha.js";
import { wsCall } from "./ws.js";
import { relTime, renderHelp, renderList, truncate, type Row } from "./toon.js";
import { registryRows, str, truncateRow } from "./entity.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const AREA_GET_ENTITY_PREVIEW = 8;
const PERIODS: Record<string, true> = { hour: true, day: true, month: true };

const AREA_USAGE = [
  "usage: ha-axi area <list | get <id-or-name>>",
  "example: ha-axi area get kitchen",
];
const DEVICE_USAGE = [
  "usage: ha-axi device list [--area <id-or-name>]",
  "example: ha-axi device list --area Kitchen",
];
const STATISTICS_USAGE = [
  "usage: ha-axi statistics ids",
  "       ha-axi statistics get <id...> [--start <ISO>] [--period hour|day|month] [--full]",
  "example: ha-axi statistics get sensor.kitchen_temperature --period day",
];

type HaState = {
  entity_id?: unknown;
  state?: unknown;
  attributes?: Record<string, unknown> | null;
};

type ParsedArea = {
  areaId: string;
  name: string;
  aliases: string[];
};

type Registries = {
  areas: ParsedArea[];
  devices: Array<Record<string, unknown>>;
  entities: Array<Record<string, unknown>>;
  /** entity_id -> resolved area id (own area_id wins, else the device's). */
  areaIdByEntity: Map<string, string>;
};

/** Case-insensitive match against id, name, or any alias (contract #15). */
function matchesArea(target: string, area: ParsedArea): boolean {
  const want = target.toLowerCase();
  return (
    area.areaId.toLowerCase() === want ||
    area.name.toLowerCase() === want ||
    area.aliases.some((a) => a.toLowerCase() === want)
  );
}

/**
 * One-shot bridge read of all three registries plus the entity->area index,
 * using the same inheritance rule as `entity list`: an entity's own area_id
 * wins, otherwise it inherits its device's area_id.
 */
async function loadRegistries(cfg: ResolvedConfig): Promise<Registries> {
  const [areasRaw, devicesRaw, entitiesRaw] = await Promise.all([
    wsCall(cfg, "config/area_registry/list"),
    wsCall(cfg, "config/device_registry/list"),
    wsCall(cfg, "config/entity_registry/list"),
  ]);
  const areas = registryRows(areasRaw).map((a) => ({
    areaId: str(a["area_id"]) ?? "",
    name: str(a["name"]) ?? str(a["area_id"]) ?? "",
    aliases: Array.isArray(a["aliases"])
      ? a["aliases"].filter((x): x is string => typeof x === "string")
      : [],
  }));

  const areaIdByDevice = new Map<string, string>();
  for (const d of registryRows(devicesRaw)) {
    const id = str(d["id"]);
    const areaId = str(d["area_id"]);
    if (id && areaId) areaIdByDevice.set(id, areaId);
  }
  const entities = registryRows(entitiesRaw);
  const areaIdByEntity = new Map<string, string>();
  for (const e of entities) {
    const entityId = str(e["entity_id"]);
    if (!entityId) continue;
    const areaId = str(e["area_id"]) ?? areaIdByDevice.get(str(e["device_id"]) ?? "");
    if (areaId) areaIdByEntity.set(entityId, areaId);
  }

  return { areas, devices: registryRows(devicesRaw), entities, areaIdByEntity };
}

/** Entity count per area id over the joined registries. */
function countsByArea(areaIdByEntity: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const areaId of areaIdByEntity.values()) {
    counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
  }
  return counts;
}

// ---------- area ----------

async function areaList(ctx?: GlobalFlags): Promise<string> {
  const cfg = await resolveConfig(ctx ?? {});
  const { areas, areaIdByEntity } = await loadRegistries(cfg);

  if (areas.length === 0) {
    // Empty results are definitive: count + note + retry hint, exit 0.
    return `${encode({
      count: 0,
      note: "no areas defined",
      hint: "assign areas under Home Assistant settings > areas & labels",
    })}\n`;
  }

  const counts = countsByArea(areaIdByEntity);
  const rows: Row[] = [...areas]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.areaId, name: a.name, count: counts.get(a.areaId) ?? 0 }));
  return `${encode({ areas: rows.length })}\n---\n${renderList("areas", rows)}\n${renderHelp([
    "area get <id-or-name> for detail",
  ])}\n`;
}

async function areaGet(target: string, ctx?: GlobalFlags): Promise<string> {
  const cfg = await resolveConfig(ctx ?? {});
  const { areas, areaIdByEntity } = await loadRegistries(cfg);

  const area = areas.find((a) => matchesArea(target, a));
  if (!area || !area.areaId) {
    throw new AxiError(`Unknown area: ${target}`, "NOT_FOUND", [
      "run `ha-axi area list` to see available areas",
    ]);
  }

  const entityIds = [...areaIdByEntity.entries()]
    .filter(([, areaId]) => areaId === area.areaId)
    .map(([entityId]) => entityId)
    .sort();
  const detail: Row = {
    id: area.areaId,
    name: area.name,
    alias_count: area.aliases.length,
    entities: entityIds.length,
  };
  const help = [`entity list --area ${area.name} for the full inventory`];
  if (entityIds.length > AREA_GET_ENTITY_PREVIEW) {
    help.unshift(`${entityIds.length - AREA_GET_ENTITY_PREVIEW} more not shown`);
  }
  return `${encode(detail)}\n---\n${encode({
    entities: entityIds.slice(0, AREA_GET_ENTITY_PREVIEW),
  })}\n${renderHelp(help)}\n`;
}

export async function areaCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb === "list") {
    if (rest.length > 0) {
      throw new AxiError(`Unexpected argument: ${rest[0]}`, "VALIDATION_ERROR", AREA_USAGE);
    }
    return areaList(ctx);
  }
  if (verb === "get") {
    if (rest.length === 0) {
      throw new AxiError("Missing area id or name", "VALIDATION_ERROR", AREA_USAGE);
    }
    if (rest.length > 1) {
      throw new AxiError(`Unexpected argument: ${rest[1]}`, "VALIDATION_ERROR", AREA_USAGE);
    }
    return areaGet(rest[0], ctx);
  }
  throw new AxiError(
    verb ? `Unknown area command: ${verb}` : "Missing area subcommand",
    "VALIDATION_ERROR",
    AREA_USAGE,
  );
}

// ---------- device ----------

async function deviceList(args: string[], ctx?: GlobalFlags): Promise<string> {
  let areaFilter: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--area") {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined) {
        throw new AxiError("Missing value for --area", "VALIDATION_ERROR", DEVICE_USAGE);
      }
      areaFilter = value;
      continue;
    }
    if (name.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", DEVICE_USAGE);
    }
    rest.push(arg);
  }
  if (rest.length > 0) {
    throw new AxiError(`Unexpected argument: ${rest[0]}`, "VALIDATION_ERROR", DEVICE_USAGE);
  }

  const cfg = await resolveConfig(ctx ?? {});
  const { areas, devices, entities } = await loadRegistries(cfg);

  // Resolve the --area filter case-insensitively BEFORE touching rows so an
  // unknown area fails fast instead of silently returning zero devices.
  let wantedAreaId: string | undefined;
  if (areaFilter !== undefined) {
    const hit = areas.find((a) => matchesArea(areaFilter, a));
    if (!hit || !hit.areaId) {
      throw new AxiError(`Unknown area: ${areaFilter}`, "NOT_FOUND", [
        "run `ha-axi area list` to see available areas",
      ]);
    }
    wantedAreaId = hit.areaId;
  }

  const nameByAreaId = new Map(areas.map((a) => [a.areaId, a.name]));
  const entityCountByDevice = new Map<string, number>();
  for (const e of entities) {
    const deviceId = str(e["device_id"]);
    if (!deviceId) continue;
    entityCountByDevice.set(deviceId, (entityCountByDevice.get(deviceId) ?? 0) + 1);
  }

  // A device's registry row carries its own area_id directly; entities are
  // joined only for the per-device count.
  const rows = devices
    .map((d) => {
      const id = str(d["id"]) ?? "";
      const areaId = str(d["area_id"]);
      return {
        id,
        name: str(d["name_by_user"]) ?? str(d["name"]) ?? id,
        area: areaId !== undefined ? (nameByAreaId.get(areaId) ?? null) : null,
        entities: entityCountByDevice.get(id) ?? 0,
        areaId,
      };
    })
    .filter((r) => wantedAreaId === undefined || r.areaId === wantedAreaId)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return `${encode({
      count: 0,
      note: areaFilter ? `no devices in area '${areaFilter}'` : "no devices registered",
      hint: "retry with fewer filters",
    })}\n`;
  }

  const cleanRows: Row[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    area: r.area,
    entities: r.entities,
  }));
  return `${encode({ devices: cleanRows.length })}\n---\n${renderList(
    "devices",
    cleanRows,
  )}\n${renderHelp(["entity list --query <name> to find a device's entities"])}\n`;
}

export async function deviceCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb !== "list") {
    throw new AxiError(
      verb ? `Unknown device command: ${verb}` : "Missing device subcommand",
      "VALIDATION_ERROR",
      DEVICE_USAGE,
    );
  }
  return deviceList(rest, ctx);
}

// ---------- statistics ids ----------

/**
 * Derive statistic-id candidates from /api/states (see module header): sensor
 * entities with a state_class attribute OR a numeric state. No WS round-trip
 * is needed, so this works even when the recorder integration is absent.
 */
async function statsIds(ctx?: GlobalFlags): Promise<string> {
  const cfg = await resolveConfig(ctx ?? {});
  const states = (await new HaClient(cfg).get("/api/states")) as HaState[];
  if (!Array.isArray(states)) {
    throw new AxiError("Unexpected /api/states response shape", "UPSTREAM_ERROR", []);
  }

  const rows: Row[] = [];
  for (const s of states) {
    const entityId = s.entity_id;
    if (typeof entityId !== "string" || entityId.split(".")[0] !== "sensor") continue;
    const attrs = s.attributes ?? {};
    const stateClass = str(attrs["state_class"]);
    const numeric =
      typeof s.state === "string" &&
      s.state.trim() !== "" &&
      !Number.isNaN(Number(s.state.trim()));
    if (!stateClass && !numeric) continue;
    rows.push({
      id: entityId,
      state_class: stateClass ?? null,
      unit: str(attrs["unit_of_measurement"]) ?? null,
    });
  }
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (rows.length === 0) {
    return `${encode({
      count: 0,
      note: "no numeric sensor states found",
      hint: "statistics need sensors with numeric states or a state_class attribute",
    })}\n`;
  }
  return `${encode({ "statistics candidates": rows.length })}\n---\n${renderList(
    "candidates",
    rows,
  )}\n${renderHelp(["statistics get <id...> [--period hour|day|month] for summaries"])}\n`;
}

// ---------- statistics get ----------

type StatEntry = {
  start?: unknown;
  mean?: unknown;
  min?: unknown;
  max?: unknown;
  sum?: unknown;
};

async function statsGet(args: string[], ctx?: GlobalFlags): Promise<string> {
  // Validate EVERYTHING here so bad input never reaches the network.
  let period = "day";
  let start: Date | undefined;
  let full = false;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--full") {
      full = true;
      continue;
    }
    if (name === "--start" || name === "--period") {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined) {
        throw new AxiError(`Missing value for ${name}`, "VALIDATION_ERROR", STATISTICS_USAGE);
      }
      if (name === "--period") {
        if (!PERIODS[value]) {
          throw new AxiError(
            `Invalid --period: ${value}`,
            "VALIDATION_ERROR",
            [...STATISTICS_USAGE, "--period is one of hour, day, month"],
          );
        }
        period = value;
      } else {
        start = parseIsoStart(value);
      }
      continue;
    }
    if (name.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", STATISTICS_USAGE);
    }
    if (!arg.includes(".")) {
      throw new AxiError(`Invalid statistic id: ${arg}`, "VALIDATION_ERROR", [
        ...STATISTICS_USAGE,
        "statistic ids look like sensor.kitchen_temperature",
      ]);
    }
    if (!ids.includes(arg)) ids.push(arg);
  }
  if (ids.length === 0) {
    throw new AxiError("Missing statistic id", "VALIDATION_ERROR", STATISTICS_USAGE);
  }

  // Default window when no --start: last 24 hours, matching history/logbook.
  const startTime = (start ?? new Date(Date.now() - DAY_MS)).toISOString();
  const cfg = await resolveConfig(ctx ?? {});
  const result = await wsCall(cfg, "recorder/statistics_during_period", {
    statistic_ids: ids,
    start_time: startTime,
    period,
  });
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new AxiError(
      "Unexpected recorder/statistics_during_period response shape",
      "UPSTREAM_ERROR",
      [],
    );
  }
  const buckets = result as Record<string, unknown>;

  const blocks: string[] = [];
  const noData: string[] = [];
  let shown = 0;
  for (const id of ids) {
    const entries = buckets[id];
    if (!Array.isArray(entries)) {
      noData.push(id);
      continue;
    }
    const rows: Row[] = (entries as StatEntry[]).map((e) => {
      const row: Row = {
        id,
        start: typeof e.start === "string" ? relTime(e.start) : "?",
        mean: e.mean ?? null,
        min: e.min ?? null,
        max: e.max ?? null,
      };
      if (full) row.sum = e.sum ?? null;
      return row;
    });
    blocks.push(
      renderList(
        id,
        full
          ? rows
          : rows.map((r) =>
              Object.fromEntries(Object.entries(r).map(([k, v]) => [k, truncate(v)])),
            ),
      ),
    );
    shown += 1;
  }

  blocks.unshift(encode({ statistics: shown }));
  for (const id of noData) blocks.push(`no data: ${id}`);
  const help = [
    ...(noData.length > 0
      ? ["no recorder data for those ids; check `statistics ids` for known candidates"]
      : []),
    "statistics ids lists every derived candidate",
  ];
  return `${blocks.join("\n---\n")}\n${renderHelp(help)}\n`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseIsoStart(value: string): Date {
  const invalid = () =>
    new AxiError(`Invalid ISO 8601 timestamp for --start: ${value}`, "VALIDATION_ERROR", [
      ...STATISTICS_USAGE,
      "timestamps look like 2026-01-01T00:00:00Z",
    ]);
  if (!ISO_RE.test(value)) throw invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid();
  return date;
}

export async function statisticsCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb === "ids") return statsIds(ctx);
  if (verb === "get") return statsGet(rest, ctx);
  throw new AxiError(
    verb ? `Unknown statistics command: ${verb}` : "Missing statistics subcommand",
    "VALIDATION_ERROR",
    STATISTICS_USAGE,
  );
}
