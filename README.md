# ha-axi

**Agent control for Home Assistant without an MCP server.**

`ha-axi` is a single stateless CLI that wraps the Home Assistant REST API (plus
a one-shot WebSocket bridge for registry reads) and speaks TOON: compact,
lossless, token-efficient output designed for agents. No persistent
connections, no daemon, no MCP transport to babysit — every invocation is one
process, a few HTTP calls, and a structured envelope back.

## Why not an MCP server?

| | MCP server | ha-axi |
| --- | --- | --- |
| Transport | persistent process + protocol state | stateless subprocess per call |
| Output format | tool-call JSON blobs | TOON (`@toon-format/toon`) |
| Safety gates | per-server, ad hoc | hard client-side domain excludes, bulk-target refusal, dry-run |
| Failure surface | connection lifetime bugs | structured `{error, code}` envelopes + script-friendly exit codes |

## Install

```sh
npm install -g ha-axi
```

Requires Node >= 20.

## Quickstart

1. **Create a long-lived access token (LLAT)** in Home Assistant:
   *Settings → People → your user → Security → Long-lived access tokens*.
   Copy it once — it is shown only at creation time.

2. **Point ha-axi at your instance**, either via env:

   ```sh
   export HASS_URL=https://hass.example
   export HASS_TOKEN=<long-lived-access-token>
   ```

   or a named profile in `~/.config/ha-axi/config.toml`:

   ```toml
   [profiles.default]
   url = "https://hass.example"
   token = "<long-lived-access-token>"
   ```

3. **Verify:**

   ```sh
   ha-axi ping
   ```

4. **First queries:**

   ```sh
   ha-axi                      # dashboard: counts, unavailable, low battery, stale
   ha-axi entity list --domain light
   ha-axi entity get light.kitchen
   ha-axi service list --domain light
   ```

## Commands

Bare `ha-axi` prints a dashboard: profile · version · entity count, then four
blocks from one `/api/states` fetch — domain counts, unavailable/unknown
entities, sensors with `battery_level < 20`, and entities whose state is older
than 24 hours.

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

Every command closes with 1–2 `help:` suggestion lines pointing at a sensible
next step. Errors are always structured TOON `{error, code}` with exit codes
mapped for scripting.

## Safety

ha-axi is built for agents operating unattended, so the guardrails are
client-side and non-negotiable:

- **Gated domains** — `lock`, `alarm_control_panel`, and `cover` mutations are
  refused before any network call (`DOMAIN_EXCLUDED`). Reads on those domains
  are unaffected. See [docs/adr/0001-hard-exclude-gated-domains.md](docs/adr/0001-hard-exclude-gated-domains.md).
- **Non-concrete targets refused** — `entity_id: all`, area/device targeting on
  mutations return `BULK_TARGET_REFUSED` unless you pass the explicit
  `--i-mean-all` override.
- **Dry-run** — `service call --dry-run` prints the exact request and exits 0
  without sending anything.

## Ambient hooks

```sh
ha-axi setup hooks            # install for Claude / Codex / OpenCode
ha-axi setup hooks --check    # OK / DRIFT report
```

The hook runs `ha-axi ping` only and injects one line
(`[ha-axi] <profile> up · v<version> · N entities · Xms`) at session start.
Failures collapse to a single `[ha-axi] unreachable` line and never block a
session.

## License

MIT
