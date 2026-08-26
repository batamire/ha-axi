import { encode } from "@toon-format/toon";
import { resolveConfig, type GlobalFlags } from "./config.js";
import { HaClient } from "./ha.js";
import { renderHelp } from "./toon.js";

type EntityState = {
  entity_id?: unknown;
  state?: unknown;
  attributes?: unknown;
  last_updated?: unknown;
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const LOW_BATTERY_THRESHOLD = 20;

/** Numeric battery_level attribute (number or numeric string); undefined otherwise. */
function batteryPct(attributes: unknown): number | undefined {
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const raw = (attributes as Record<string, unknown>)["battery_level"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

function isStale(lastUpdated: unknown, now: number): boolean {
  if (typeof lastUpdated !== "string" || lastUpdated === "") return false;
  const ts = Date.parse(lastUpdated);
  return Number.isFinite(ts) && now - ts > STALE_AFTER_MS;
}

/**
 * Bare `ha-axi` dashboard (#8): header line + four blocks derived from ONE
 * `/api/states` fetch (+ `/api/config` for the version).
 */
export async function buildDashboard(flags: GlobalFlags): Promise<string> {
  const cfg = await resolveConfig(flags);
  const ha = new HaClient(cfg);
  // Exactly two HTTP hits per dashboard render.
  const [statesRaw, configRaw] = await Promise.all([
    ha.get("/api/states"),
    ha.get("/api/config"),
  ]);
  const states = Array.isArray(statesRaw) ? (statesRaw as EntityState[]) : [];
  const version =
    typeof (configRaw as { version?: unknown } | null)?.version === "string"
      ? ((configRaw as { version: string }).version)
      : "unknown";

  const domainCounts: Record<string, number> = {};
  const unavailable: string[] = [];
  const lowBattery: string[] = [];
  const stale: string[] = [];
  const now = Date.now();

  for (const s of states) {
    if (typeof s.entity_id !== "string") continue;
    const dot = s.entity_id.indexOf(".");
    const domain = dot === -1 ? s.entity_id : s.entity_id.slice(0, dot);
    domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    if (s.state === "unavailable" || s.state === "unknown") {
      unavailable.push(s.entity_id);
      continue; // an unavailable sensor carries no battery reading
    }
    const pct = batteryPct(s.attributes);
    if (pct !== undefined && pct < LOW_BATTERY_THRESHOLD) {
      lowBattery.push(`- ${s.entity_id} (${pct}%)`);
    }
    if (isStale(s.last_updated, now)) stale.push(s.entity_id);
  }

  const sortIds = (a: string, b: string) => a.localeCompare(b);
  unavailable.sort(sortIds);
  lowBattery.sort(sortIds);
  stale.sort(sortIds);

  const lines: string[] = [];
  lines.push(
    `profile: ${cfg.profile} · version: ${version} · ${states.length} entities`,
  );
  const counts: Record<string, number> = {};
  for (const d of Object.keys(domainCounts).sort()) counts[d] = domainCounts[d];
  lines.push(encode({ domain: counts }));
  if (unavailable.length > 0) lines.push(encode({ unavailable }).trimEnd());
  if (lowBattery.length > 0) lines.push(encode({ low_battery: lowBattery }).trimEnd());
  if (stale.length > 0) lines.push(encode({ stale }).trimEnd());
  lines.push(
    renderHelp([
      "`entity list` for the full inventory",
      "`service list --domain <d>` for callable services",
    ]),
  );
  return `${lines.join("\n")}\n`;
}
