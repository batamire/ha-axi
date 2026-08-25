# ha-axi — ubiquitous language

One term, one meaning. Decisions live in their wayfinder tickets; this file
defines the words those decisions use.

## Home Assistant vocabulary

| Term | Meaning |
| --- | --- |
| **entity** | A controllable/reporting thing in Home Assistant, identified by its stable `entity_id` (`light.kitchen`). ha-axi's central noun. |
| **domain** | The entity's family — the part before the dot (`light`, `sensor`, `climate`). Determines which services apply. |
| **state** | An entity's current value string (`on`, `21.5`, `unavailable`) plus timestamp metadata. Output of entity reads, not a noun on the surface. |
| **attributes** | Key/value payload hanging off an entity's state (`brightness_pct`, `current_temperature`). Truncated by default under AXI rules. |
| **service** | A callable action namespaced by domain (`light.turn_on`, `vacuum.return_to_base`). The ONLY control path ha-axi exposes. |
| **service response** | Optional data blob some services return alongside changed states (`return_response` semantics). Surfaced verbatim on `service call`. |
| **area** | User-defined room/zone grouping from the area registry. High-frequency filter dimension. |
| **device** | Physical/gateway unit that can host several entities. Registry reads only in v1. |
| **template** | A Jinja2 snippet rendered server-side by HA (`/api/template`) — the escape hatch for anything the fixed verbs don't cover. |
| **history** | State timelines per entity over a time window (`/api/history/period`; requires explicit entity ids). |
| **logbook** | Human-readable event stream per entity/window (`/api/logbook`). Different shape than history; both exist as nouns. |
| **statistics** | Recorder-computed numeric summaries (min/max/mean per period). WebSocket-only upstream; reached through ha-axi's stateless bridge. |

## ha-axi vocabulary

| Term | Meaning |
| --- | --- |
| **LLAT** | Long-lived access token — bearer auth for all transports. Unscoped/all-or-nothing upstream; blast radius documented in the skill. |
| **stateless WS bridge** | One-shot WebSocket request/response calls used ONLY for registry + statistics reads. No subscriptions, no streaming, no persistent connections; every mutation rides REST paths. |
| **curated default** | `entity list`'s default view: hides housekeeping classes (entity_category `config`/`diagnostic`) and entities in `unavailable`/`unknown` state. `--all` disables both exclusions. Aggregate counts always span the full set, so hidden mass stays visible as numbers. |
| **TOON field map** | Per-noun definition of the 3–4 default fields emitted in TOON format; owned by the output-shapes prototype. |
| **aggregate** | Pre-computed summary line (count by domain/state, unavailable total) printed before rows — kills follow-up round trips. |
| **gated domain** | `lock`, `alarm_control_panel`, `cover` — mutation targets ha-axi hard-excludes. `service call` refuses them outright (structured `DOMAIN_EXCLUDED` error); state reads on their entities remain available. |
| **dry run** | `service call --dry-run`: prints the exact request that would be sent (service, resolved target ids, payload) and exits without firing. |
| **concrete target** | Explicit entity ids named on a mutation. Non-concrete targeting (`entity_id: all`, area/device bulk) is refused (`BULK_TARGET_REFUSED`) unless explicitly overridden. |
| **idempotent flag** | Per-service metadata on `service list` output marking whether re-invocation is safe (setters true; toggle/trigger/scene/script false). Curated classification, advisory only. |
| **profile** | Named connection in `~/.config/ha-axi/config.toml` (`[profiles.<name>]`): `url`, optional `timeout`/`insecure`, and a `token` (literal, file chmod 600) or `token_cmd` (delegated secret lookup, e.g. macOS Keychain or a password manager). Selected via `--profile`/`-p`; default profile used when no flag/env. |
| **credential resolution** | Deterministic order: flags → `HASS_URL`/`HASS_TOKEN` env → config profiles → stdin. Tokens never echoed; resolution is prompt-free (AXI: agents can't answer interactive prompts). |
| **ping** | `ha-axi ping`: cheapest liveness/auth probe (`/api/`) emitting TOON `{ok, profile, version, latency_ms}`. The skill's bootstrap verification step. |
| **dashboard** | Bare `ha-axi` output: profile/version/entity count plus four computed blocks from a single `/api/states` fetch — domain counts, unavailable/unknown list, low-battery sensors (<20%), stale entities (>24h silent). |
| **ambient hook** | Opt-in SessionStart hook (`ha-axi setup hooks`, Claude/Codex/OpenCode) that runs `ping` only and injects one reachability line. Full dashboard stays on-demand. |
| **invocation consent** | Entity names/areas appear only when ha-axi is explicitly invoked or its hook opted into. Hard rule regardless of invocation: `/api/config` geo fields are never fetched or emitted. |

## Deferred terms (defined when their trigger fires)

calendar · camera · event fire/list · label/floor/zone registries · raw state
writes (POST/DELETE `/api/states/<id>` — device-bypassing footgun, deliberately
absent from the surface).
