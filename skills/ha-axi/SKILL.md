---
name: ha-axi
description: Agent control for Home Assistant without an MCP server - one stateless CLI over the REST API emitting TOON for token-efficient agent output. Use for Home Assistant (hass) automation queries and safe device control, including Zigbee, HomeKit, Matter, and Thread integrations exposed through hass. Keywords: Home Assistant, hass, ha-axi, Zigbee, HomeKit, Matter, Thread.
---

# ha-axi

## When to use

Use `ha-axi` whenever a task touches a Home Assistant instance and no MCP
server is available or desired: inventorying entities, reading sensor states,
rendering templates, inspecting history/logbook, discovering services, and
calling services behind explicit safety gates. Output is always TOON -
compact, lossless, and cheap for agents to consume.

## Safety posture

- **Gated domains**: `lock`, `alarm_control_panel`, `cover` are
  hard-excluded from mutations client-side (`DOMAIN_EXCLUDED` before any
  network call). Reads on those domains are unaffected.
- **Non-concrete targets refused**: `entity_id: all`, area/device targeting
  on mutations return `BULK_TARGET_REFUSED` unless the caller passes the
  explicit `--i-mean-all` override.
- **Dry-run first**: `service call --dry-run` prints the exact request and
  exits 0 WITHOUT sending anything. Prefer it before any real call.
- Errors are structured TOON `{error, code}` envelopes; exit codes are
  script-friendly.

## Commands

Bare `ha-axi` prints a dashboard (profile, version, entity count, domain
counts, unavailable / low-battery / stale entities).

| command | description |
| --- | --- |
| `ping` | Liveness + auth probe (`{ok, profile, version, latency_ms}`) |
| `entity` | List and inspect entities (`list`, `get`) |
| `service` | List services; call them behind safety gates (`list`, `call`) |
| `template` | Render a Jinja2 template server-side (`render`) |
| `history` | State timelines per entity (`get`) |
| `logbook` | Human-readable event stream (`get`) |
| `area` | Area registry reads over the WS bridge (`list`, `get`) |
| `device` | Device registry reads over the WS bridge (`list`) |
| `statistics` | Recorder statistic discovery + summaries (`ids`, `get`) |
| `setup` | Install ambient SessionStart hooks for Claude/Codex/OpenCode (`hooks`) |

Global flags on every command: `--profile/-p <name>`, `--url <url>`,
`--token <token>`. Credential resolution order: flags >
`HASS_URL`/`HASS_TOKEN` env > config profiles in
`~/.config/ha-axi/config.toml` > stdin token.

## Auth bootstrap

1. In Home Assistant open **Settings → People → your user → Security →
   Long-lived access tokens** and create a token (LLAT). Copy it once - it is
   shown only at creation time.
2. Either export credentials directly:

   ```sh
   export HASS_URL=https://hass.example
   export HASS_TOKEN=<long-lived-access-token>
   ```

   or persist a named profile in `~/.config/ha-axi/config.toml`:

   ```toml
   [profiles.default]
   url = "https://hass.example"
   token = "<long-lived-access-token>"
   ```

3. Verify with `ha-axi ping` - expect `{ok: true, profile, version,
   latency_ms}`.
4. Optional ambient awareness for Claude/Codex/OpenCode sessions:
   `ha-axi setup hooks`.
