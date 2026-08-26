// Reads slice (#14): three plain-REST read verbs — `template render`,
// `history get`, `logbook get`. All default to a 24h window where a window
// exists, truncate long values at 8000 chars (--full bypasses), and keep
// empty results definitive (count/note/hint, exit 0) rather than silent.
// Upstream params verified against developers.home-assistant.io REST docs:
// history supports end_time + minimal_response; logbook supports entity +
// end_time — so explicit --end is passed through on both, not faked.
import { AxiError } from "axi-sdk-js";
import { encode } from "@toon-format/toon";
import { resolveConfig, type GlobalFlags } from "./config.js";
import { HaClient } from "./ha.js";
import { relTime, renderHelp, renderList, truncate, type Row } from "./toon.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const TEMPLATE_USAGE = [
  'usage: ha-axi template render "<template>" [--full]',
  'example: ha-axi template render "{{ states(\'light.kitchen\') }}"',
];
const HISTORY_USAGE = [
  "usage: ha-axi history get <entity_id...> [--start <ISO>] [--end <ISO>] [--full]",
  "example: ha-axi history get light.kitchen sensor.bench",
];
const LOGBOOK_USAGE = [
  "usage: ha-axi logbook get [<entity_id>] [--start <ISO>] [--end <ISO>] [--full]",
  "example: ha-axi logbook get light.kitchen",
];

type WindowFlags = {
  positionals: string[];
  start?: Date;
  end?: Date;
  full: boolean;
};

/**
 * Shared flag walker for the windowed read verbs: positional args plus
 * --start/--end (spaced and `=` forms) and boolean --full. Validation of
 * timestamps happens HERE, before any network call.
 */
function parseWindowed(args: string[], usage: string[]): WindowFlags {
  const flags: WindowFlags = { positionals: [], full: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--full") {
      if (eq !== -1) throw new AxiError("--full takes no value", "VALIDATION_ERROR", usage);
      flags.full = true;
      continue;
    }
    if (name === "--start" || name === "--end") {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined) {
        throw new AxiError(`Missing value for ${name}`, "VALIDATION_ERROR", usage);
      }
      const date = parseIso(value, name, usage);
      if (name === "--start") flags.start = date;
      else flags.end = date;
      continue;
    }
    if (name.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", usage);
    }
    flags.positionals.push(arg);
  }
  return flags;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Strict-ish ISO 8601 check so garbage fails client-side with VALIDATION_ERROR. */
function parseIso(value: string, flag: string, usage: string[]): Date {
  const invalid = () =>
    new AxiError(`Invalid ISO 8601 timestamp for ${flag}: ${value}`, "VALIDATION_ERROR", [
      ...usage,
      "timestamps look like 2026-01-01T00:00:00Z",
    ]);
  if (!ISO_RE.test(value)) throw invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid();
  return date;
}

/** Default window when no --start: last 24 hours (contract #14). */
function startIsoOf(flags: WindowFlags): string {
  return (flags.start ?? new Date(Date.now() - DAY_MS)).toISOString();
}

function requireIds(flags: WindowFlags, max: number, usage: string[]): string[] {
  const ids: string[] = [];
  for (const raw of flags.positionals) {
    if (!raw.includes(".")) {
      throw new AxiError(`Invalid entity id: ${raw}`, "VALIDATION_ERROR", [
        ...usage,
        "entity ids look like light.kitchen",
      ]);
    }
    if (!ids.includes(raw)) ids.push(raw);
    if (ids.length > max) {
      throw new AxiError(`Unexpected argument: ${raw}`, "VALIDATION_ERROR", usage);
    }
  }
  return ids;
}

export async function templateCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb !== "render") {
    throw new AxiError(
      verb ? `Unknown template command: ${verb}` : "Missing template subcommand",
      "VALIDATION_ERROR",
      TEMPLATE_USAGE,
    );
  }
  let full = false;
  const positionals: string[] = [];
  for (const arg of rest) {
    if (arg === "--full" || arg.startsWith("--full=")) {
      full = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", TEMPLATE_USAGE);
    }
    positionals.push(arg);
  }
  if (positionals.length === 0) {
    throw new AxiError("Missing template string", "VALIDATION_ERROR", TEMPLATE_USAGE);
  }
  if (positionals.length > 1) {
    throw new AxiError(
      `Unexpected argument: ${positionals[1]}`,
      "VALIDATION_ERROR",
      TEMPLATE_USAGE,
    );
  }

  // The rendered result may itself be JSON text or contain newlines; it is
  // kept verbatim inside the encoded value.
  const ha = new HaClient(await resolveConfig(ctx ?? {}));
  const result = await ha.postText("/api/template", { template: positionals[0] });

  const help =
    result.length === 0
      ? ["template rendered to an empty string"]
      : ["history get <entity_id> to inspect the states behind a template"];
  return `${encode({ result: full ? result : truncate(result) })}\n${renderHelp(help)}\n`;
}

// ---------- history get ----------

type HaTimelineState = {
  entity_id?: unknown;
  state?: unknown;
  last_changed?: unknown;
  last_updated?: unknown;
};

function changedOf(st: HaTimelineState): string {
  const iso = typeof st.last_changed === "string" ? st.last_changed : st.last_updated;
  return typeof iso === "string" ? relTime(iso) : "?";
}

export async function historyCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb !== "get") {
    throw new AxiError(
      verb ? `Unknown history command: ${verb}` : "Missing history subcommand",
      "VALIDATION_ERROR",
      HISTORY_USAGE,
    );
  }
  const flags = parseWindowed(rest, HISTORY_USAGE);
  const ids = requireIds(flags, Number.MAX_SAFE_INTEGER, HISTORY_USAGE);
  if (ids.length === 0) {
    throw new AxiError("Missing entity id", "VALIDATION_ERROR", HISTORY_USAGE);
  }

  const params = new URLSearchParams({
    filter_entity_id: ids.join(","),
    minimal_response: "1",
  });
  if (flags.end) params.set("end_time", flags.end.toISOString());
  const path = `/api/history/period/${encodeURIComponent(startIsoOf(flags))}?${params.toString()}`;

  const ha = new HaClient(await resolveConfig(ctx ?? {}));
  const response = await ha.get(path);
  if (!Array.isArray(response)) {
    throw new AxiError("Unexpected /api/history/period response shape", "UPSTREAM_ERROR", []);
  }

  // One timeline per entity, keyed off each entry's own entity_id so server
  // ordering never misattributes rows.
  const timelines = new Map<string, HaTimelineState[]>();
  for (const timeline of response as unknown[]) {
    if (!Array.isArray(timeline)) continue;
    for (const st of timeline as HaTimelineState[]) {
      if (typeof st.entity_id !== "string") continue;
      const bucket = timelines.get(st.entity_id) ?? [];
      bucket.push(st);
      timelines.set(st.entity_id, bucket);
    }
  }

  const rowsFor = (id: string): Row[] => {
    const timeline = timelines.get(id) ?? [];
    return timeline.map((st) => ({ state: String(st.state ?? ""), changed: changedOf(st) }));
  };

  const blocks: string[] = [];
  const noData: string[] = [];
  let shown = 0;
  for (const id of ids) {
    const rows = rowsFor(id).map((row) =>
      flags.full ? row : { ...row, state: truncate(row.state) },
    );
    if (rows.length === 0) noData.push(id);
    else blocks.push(renderList(id, rows));
    shown += rows.length > 0 ? 1 : 0;
  }

  // Absence stays definitive: every requested id with an empty timeline gets
  // an explicit line instead of being silently dropped.
  blocks.unshift(encode({ entities: shown }));
  for (const id of noData) blocks.push(`no data: ${id}`);
  const help = [
    ...(noData.length > 0 ? ["widen the window with --start/--end for entities without data"] : []),
    "logbook get <id> for the human-readable event stream",
  ];
  return `${blocks.join("\n---\n")}\n${renderHelp(help)}\n`;
}

// ---------- logbook get ----------

type HaLogbookEntry = {
  when?: unknown;
  name?: unknown;
  state?: unknown;
  message?: unknown;
  entity_id?: unknown;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function logbookCommand(args: string[], ctx?: GlobalFlags): Promise<string> {
  const [verb, ...rest] = args;
  if (verb !== "get") {
    throw new AxiError(
      verb ? `Unknown logbook command: ${verb}` : "Missing logbook subcommand",
      "VALIDATION_ERROR",
      LOGBOOK_USAGE,
    );
  }
  const flags = parseWindowed(rest, LOGBOOK_USAGE);
  const [id] = requireIds(flags, 1, LOGBOOK_USAGE);
  const params = new URLSearchParams();
  if (id) params.set("entity", id);
  if (flags.end) params.set("end_time", flags.end.toISOString());
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const path = `/api/logbook/${encodeURIComponent(startIsoOf(flags))}${query}`;

  const ha = new HaClient(await resolveConfig(ctx ?? {}));
  const entries = await ha.get(path);
  if (!Array.isArray(entries)) {
    throw new AxiError("Unexpected /api/logbook response shape", "UPSTREAM_ERROR", []);
  }

  // Message-only entries (no state) fall back to their message text so the
  // row still explains what happened.
  const rows = (entries as HaLogbookEntry[]).map((entry) => ({
    when: typeof entry.when === "string" ? relTime(entry.when) : "?",
    name: str(entry.name) ?? "",
    state: str(entry.state) ?? str(entry.message) ?? "",
    entity_id: str(entry.entity_id) ?? "",
  }));

  // Empty windows stay definitive and point at the obvious next move.
  if (rows.length === 0) {
    return `${encode({
      count: 0,
      note: "no logbook entries in window",
      hint: "widen the window with --start/--end",
    })}\n${renderHelp([`history get ${id ?? "<entity_id>"} for compact state timelines`])}\n`;
  }

  const shaped = rows.map((row) =>
    flags.full ? row : Object.fromEntries(Object.entries(row).map(([k, v]) => [k, truncate(v)])),
  );
  return `${encode({ count: rows.length })}\n---\n${renderList("entries", shaped)}\n${renderHelp([
    `history get ${id ?? "<entity_id>"} for compact state timelines`,
  ])}\n`;
}
