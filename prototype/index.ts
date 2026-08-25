// PROTOTYPE — wayfinder ticket #5 (TOON output shapes for core reads).
// Throwaway: generates real TOON via @toon-format/toon from synthetic HA payloads.
// Run: bun run index.ts   (from prototype/)
// All entity ids, areas, names are synthetic. No live instance touched.
import { encode } from "@toon-format/toon";

// ---------- synthetic HA state payload (/api/states shape) ----------
type HaState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
};

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

// area map pretends the WS bridge answered "entity -> area"
const AREA: Record<string, string> = {
  "light.kitchen": "kitchen",
  "light.living_room": "living room",
  "light.hallway": "hallway",
  "climate.hallway": "hallway",
  "sensor.living_room_temperature": "living room",
  "sensor.kitchen_motion": "kitchen",
  "binary_sensor.front_door_contact": "hallway",
  "switch.coffee_machine": "kitchen",
  "vacuum.roomba": null as unknown as string,
};

const states: HaState[] = [
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen Light", brightness_pct: 80, supported_color_modes: ["color_temp"] }, last_changed: ago(42), last_updated: ago(42) },
  { entity_id: "light.living_room", state: "off", attributes: { friendly_name: "Living Room Light" }, last_changed: ago(180), last_updated: ago(180) },
  { entity_id: "light.hallway", state: "unavailable", attributes: { friendly_name: "Hallway Light" }, last_changed: ago(2880), last_updated: ago(2880) },
  { entity_id: "climate.hallway", state: "heat", attributes: { friendly_name: "Hallway Thermostat", current_temperature: 21.4, temperature: 21.5 }, last_changed: ago(15), last_updated: ago(15) },
  { entity_id: "sensor.living_room_temperature", state: "21.9", attributes: { friendly_name: "Living Room Temperature", device_class: "temperature", unit_of_measurement: "\u00B0C" }, last_changed: ago(5), last_updated: ago(5) },
  { entity_id: "sensor.kitchen_motion", state: "off", attributes: { friendly_name: "Kitchen Motion", device_class: "motion" }, last_changed: ago(120), last_updated: ago(120) },
  { entity_id: "binary_sensor.front_door_contact", state: "on", attributes: { friendly_name: "Front Door", device_class: "door" }, last_changed: ago(300), last_updated: ago(300) },
  { entity_id: "switch.coffee_machine", state: "off", attributes: { friendly_name: "Coffee Machine" }, last_changed: ago(600), last_updated: ago(600) },
  { entity_id: "vacuum.roomba", state: "returning", attributes: { friendly_name: "Roomba", battery_level: 64 }, last_changed: ago(8), last_updated: ago(8) },
];

// pretend these exist but are curated-out
const hiddenHousekeeping = ["sensor.cpu_speed", "binary_sensor.zigbee_coordinator"];
const hiddenUnavail = ["light.hallway"];

function relTime(iso: string): string {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / 1440)}d`;
}

const out = (title: string, body: string) =>
  `\n===== ${title} =====\n${body}\n`;

// ---------- field maps under test ----------
type Row = Record<string, unknown>;

function entityRow(s: HaState): Row {
  return {
    id: s.entity_id,
    name: s.attributes.friendly_name ?? s.entity_id,
    state: s.state,
    changed: relTime(s.last_changed),
  };
}

// =========================================================
// A. entity list  (curated default)
// =========================================================
const visible = states.filter(
  (s) => s.state !== "unavailable" && s.state !== "unknown",
);

const domainCounts: Row = {};
for (const s of states) {
  const d = s.entity_id.split(".")[0];
  domainCounts[d] = ((domainCounts[d] as number) ?? 0) + 1;
}

// decided: count + unavailable always; domain map behind --counts
const listAggregates = [
  encode({ count: `${visible.length} of ${states.length} total` }),
  encode({ unavailable: `${hiddenUnavail.length} hidden` }),
].join("\n");

const countsVariant =
  "with --counts:\n" + encode({ domain: domainCounts });

const entityList =
  listAggregates +
  "\n---\n" +
  encode({ entities: visible.map(entityRow) }) +
  "\n" +
  `help[2]:\n  entity get <id> for detail\n  entity list --full for complete fields` +
  "\n" +
  countsVariant;

console.log(out("A. entity list (default, curated)", entityList));

// variant B: --all disables exclusions
const allRows = states.map((s) => {
  const base = entityRow(s);
  return hiddenHousekeeping.includes(s.entity_id)
    ? { ...base, category: "diagnostic" }
    : base;
});
console.log(
  out(
    "B. entity list --all",
    encode({ count: `${states.length} of ${states.length} total` }) +
      "\n---\n" +
      encode({ entities: allRows }),
  ),
);

// variant C: filtered
const filtered = visible.filter((s) => s.entity_id.startsWith("light."));
console.log(
  out(
    "C. entity list --domain light --area kitchen",
    encode({ count: `${filtered.length} of ${states.length} total` }) +
      "\n---\n" +
      encode({ entities: filtered.map(entityRow) }),
  ),
);

// empty state: definitive, names what's hidden and the retry
console.log(
  out(
    "D. entity list --query 'garage'  (no matches)",
    encode({
      count: 0,
      note: "no entities match 'garage'",
      hint: "3 entities hidden by curated view; retry with --all",
    }),
  ),
);

// =========================================================
// E. entity get (single)
// =========================================================
const kitchen = states[0];
const detail = {
  id: kitchen.entity_id,
  name: kitchen.attributes.friendly_name,
  state: kitchen.state,
  area: AREA[kitchen.entity_id],
  changed: relTime(kitchen.last_changed),
  attrs: { brightness_pct: 80 },
};
console.log(
  out(
    "E. entity get light.kitchen",
    encode(detail) +
      "\nhelp[1]:\n  service call light.turn_on --entity light.kitchen",
  ),
);

// =========================================================
// F. service list (with #4's idempotent metadata)
// =========================================================
const services = [
  { service: "turn_on", idempotent: true, desc: "Turn on light" },
  { service: "turn_off", idempotent: true, desc: "Turn off light" },
  { service: "toggle", idempotent: false, desc: "Toggle light" },
];
console.log(
  out(
    "F. service list --domain light",
    encode({ count: services.length }) +
      "\n---\n" +
      encode({ services }) +
      "\nhelp[1]:\n  service call light.turn_on --entity <id>",
  ),
);

// gated-domain refusal (#4 decision) in the same shape agents will see
console.log(
  out(
    "G. service call lock.front_door lock  (refused)",
    encode({
      error: '"lock" is a gated domain; ha-axi refuses mutations to it',
      code: "DOMAIN_EXCLUDED",
    }) + "\nhelp[1]:\n  check state read-only: entity get lock.front_door",
  ),
);

// =========================================================
// H. template render
// =========================================================
console.log(
  out(
    "H. template render \"{{ states('climate.hallway') }}\"",
    encode({ result: "heat" }),
  ),
);

// truncation demo: long attribute value clipped at 200 chars here (8000 in v1)
const longVal = "x".repeat(260);
console.log(
  out(
    "I. truncation rule demo",
    encode({
      value: longVal.slice(0, 200) + `... [truncated 60 chars, use --full]`,
    }),
  ),
);
