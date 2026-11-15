// Trigger string agents match against to auto-load the skill. Kept terse and
// outcome-focused so it fires on Home Assistant jargon.
export const SKILL_DESCRIPTION =
  "Agent control for Home Assistant without an MCP server - one stateless CLI over the REST API emitting TOON for token-efficient agent output. Use for Home Assistant (hass) automation queries and safe device control, including Zigbee, HomeKit, Matter, and Thread integrations exposed through hass. Keywords: Home Assistant, hass, ha-axi, Zigbee, HomeKit, Matter, Thread.";

// Harnesses that don't know these fields ignore them.
export const HERMES_TAGS = [
  "home-assistant",
  "hass",
  "smart-home",
  "zigbee",
  "homekit",
  "matter",
  "thread",
];

export const HERMES_CATEGORY = "smart-home";

/**
 * Single source of truth for the installable skill: SKILL.md stays a pointer,
 * never a copy. Installed skills go stale independently of releases, so
 * command, flag, and workflow guidance is left to `ha-axi --help`, which ships
 * with the binary and cannot drift from it.
 */
export function createSkillMarkdown(): string {
return `---
name: ha-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
user-invocable: false
metadata:
  hermes:
    category: ${HERMES_CATEGORY}
    tags: [${HERMES_TAGS.join(", ")}]
---

# ha-axi

Agent control for Home Assistant without an MCP server: one stateless CLI over
the REST API plus a one-shot WebSocket bridge for registry reads, emitting TOON
for token-efficient output. Use it whenever a task touches a Home Assistant
instance.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file -
installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y ha-axi\` for a dashboard of the instance (profile, version, entity
  count, domain counts, unavailable / low-battery / stale entities)
- \`npx -y ha-axi --help\` for global flags and the command index
- \`npx -y ha-axi <command> --help\` for per-command usage

Auth bootstrap, config profiles, connection fallback, and the safety gates
(gated domains, bulk-target refusal, dry-run) are documented there. Mutating
calls are guarded client-side regardless of what this file says.
`;
}
