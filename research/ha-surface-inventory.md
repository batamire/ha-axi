# HA agent-facing surface inventory (research for #3)

Ticket: batamire/ha-axi#2. Question: what can an agent already reach in Home Assistant, and where does an AXI-style command surface add value? All findings below were read from primary sources on 2026-08-24. All URLs and entity examples are synthetic (`hass.example`, `light.example`); no real instance data.

## 1. REST API coverage

Source: <https://developers.home-assistant.io/docs/api/rest/> (read in full).

Auth: every call carries `Authorization: Bearer <token>`. JSON only, same port as frontend (8123 by default).

Documented endpoints:

| Endpoint | Verbs | Notes |
| --- | --- | --- |
| `/api/` | GET | liveness ping (`{"message": "API running."}`) |
| `/api/config` | GET | full core config snapshot |
| `/api/components` | GET | loaded integration list |
| `/api/events` | GET | event names + listener counts |
| `/api/services` | GET | service registry as domain → services arrays |
| `/api/states` | GET | all states, unbounded array |
| `/api/states/<entity_id>` | GET / POST / DELETE | POST creates/overwrites state representation only — never talks to the device; DELETE removes the state object |
| `/api/history/period/<ts>` | GET | requires `filter_entity_id`; opts `end_time`, `minimal_response`, `no_attributes`, `significant_changes_only` |
| `/api/logbook/<ts>` | GET | opts `entity`, `end_time` |
| `/api/template` | POST | render Jinja template, plain-text response |
| `/api/events/<event_type>` | POST | fire arbitrary event with data |
| `/api/services/<domain>/<service>` | POST | service call; returns changed states; `?return_response` splits response into `changed_states` + `service_response`; 400 if used/mismatched with a service that does not/must return data |
| `/api/config/core/check_config` | POST | config validity check |
| `/api/intent/handle` | POST | intent handling (needs `intent:` enabled) |
| `/api/error_log`, `/api/error/all` | GET | plaintext error log |
| `/api/camera_proxy/<entity_id>` | GET | image bytes |
| `/api/calendars`, `/api/calendars/<entity>` | GET | calendar entities and events in window |

Error/status shapes: success is 200 or 201 (201 only when POST created a new state object, plus a Location header). Documented failures: 400 bad request (malformed body, `return_response` mismatch), 401 unauthorized (bad/expired token), 404 unknown entity/path, 405 wrong method. The auth/token endpoint additionally returns 403 for inactive users. Bodies are ad-hoc JSON (`{"error": ..., "message"/"errors": ...}`) — there is **no uniform error envelope** across endpoint classes.

Pagination: **none**. No endpoint documents pagination parameters; `/api/states`, history, and logbook return complete unbounded arrays. A CLI must filter client-side or rely on query params like `filter_entity_id`.

Key gap: registry management is **not in REST**. Area/device/entity/floor/label registry CRUD and zone CRUD exist only as WebSocket commands (`config/area_registry/list|create|update|delete|reorder`, `recorder/*`, etc.), verified against core source: `homeassistant/components/config/area_registry.py` registers them via `websocket_api.async_register_command` with `@require_admin`. Statistics likewise: `recorder/statistics_during_period`, `recorder/list_statistic_ids`, `recorder/get_statistics_metadata` are WebSocket commands in `homeassistant/components/recorder/websocket_api.py` — there is no documented REST `/api/statistics`.

What an AXI noun would add per row: see coverage matrix below.

## 2. Long-lived access tokens

Sources: <https://developers.home-assistant.io/docs/auth_api/> (full), cross-checked against <https://www.home-assistant.io/integrations/mcp_server/#access-control>.

- Creation: profile page → Security → "Long-lived access tokens" → Create Token; or WebSocket command `auth/long_lived_access_token` with `client_name` and optional `lifespan` (days).
- Expiry: UI-created tokens valid **10 years**; WS-created tokens use the given `lifespan`. The token string is displayed once and never stored server-side.
- Alternative: OAuth2 (IndieAuth-flavored). Authorization-code grant at `/auth/authorize` + `/auth/token` yields short-lived access tokens (`expires_in: 1800`) plus refresh tokens; refresh via `grant_type=refresh_token`; revoke at `/auth/revoke` (always 200, empty body).
- Header form for both kinds: `Authorization: Bearer <token>`; 401 means re-auth.
- Scoping: **tokens are not scoped.** Access control is user-level (admin flag gates registry/config commands and non-Assist MCP APIs) plus Assist "exposed entities" for conversation surfaces. HA 2025.11 added OAuth scope support for the MCP flow (core PR "Add Model Context Protocol support for OAuth scopes"), but LLATs themselves remain all-or-nothing. Implication for ha-axi: document that a leaked CLI token grants everything; recommend short-lifespan tokens minted via WS where automation allows.

## 3. Official MCP Server integration

Sources: <https://www.home-assistant.io/integrations/mcp_server/> (full), core repo manifest + release tags (bisect), changelog PRs.

- Introduced in **Home Assistant 2025.2** (docs page states this explicitly; confirmed by tag bisect: absent at `2025.1.4`, present at `2025.2.0`). Maintained by @allenporter, silver quality scale, ~3.7% adoption per analytics page.
- Transport: **Streamable HTTP**, stateless, exposed at `/api/mcp` (per-API variant `/api/mcp/<api_id>`, e.g. `/api/mcp/assist` for non-admins). stdio-only clients bridge via `mcp-proxy`. OAuth supported; long-lived tokens accepted as fallback.
- Capabilities: Tools and Prompts supported. Resources only as the read-only `homeassistant://assist/context-snapshot` (requires `GetLiveContext` tool). Sampling and notifications unsupported ("Known limitations" section).
- Read vs write: tools are whatever the configured LLM API (default Assist) exposes. Writes are gated by the "Control Home Assistant" option and the Assist exposed-entities pipeline; reads beyond the live-context snapshot are essentially absent — no history, logbook, statistics, registry, or raw-state access through MCP.
- What a REST CLI offers over it: deterministic, LLM-free invocation (no tool-calling round trip or prompt cost); access to surfaces MCP never sees — raw state CRUD, history/logbook/statistics, registries, templates, config check; scriptability in shell pipelines without an MCP host; usable by agents that lack MCP clients entirely.

## 4. hass-cli viability

Canonical repo: `home-assistant-ecosystem/home-assistant-cli` (Python, ~589 stars, not archived).

- Release history: 0.9.3 (2021-04), 0.9.4 (2021-06), 0.9.5 (2022-10), then **1.0.0 on 2026-04-12** — a ~3.5-year gap between releases; repo shows activity again (last push 2026-08).
- Shape: click-based thin wrapper over the REST API; output is human-oriented tabulate tables with jsonpath column selectors; YAML option; covers state/service/template/area/device/event/info/raw/system plus supervisor-token support.
- Verdict: **not worth wrapping.** Its UX targets humans (tables, interactive completion), it has no agent-first ergonomics, its release cadence has been unreliable, and wrapping adds a dependency layer over endpoints we would call directly anyway. Build ha-axi natively on the REST + WebSocket APIs; treat hass-cli as prior art, not a foundation.

## 5. Upstream AXI catalog duplication check

Source: `catalog.yaml` at `github.com/kunchenguid/axi` (fetched raw; 48 entries scanned).

Result: **no Home Assistant entry** and no smart-home/smartthing/hass-related entries of any kind. ha-axi would be a new catalog domain, not a duplicate.

## 6. Name availability

- npm: `npm view ha-axi` → **E404 Not Found**. Name free.
- GitHub: search for repos named `ha-axi` returns only fuzzy substring hits (`haxe-axios`, VHDL `AXI_regmap`, etc.) — **no prominent exact-name squatter**.
- Verdict: `ha-axi` is available on both npm and GitHub.

## Coverage matrix (surface → AXI opportunity)

| Surface | Reachable today | Gap / AXI noun opportunity |
| --- | --- | --- |
| States list/read/write/delete | REST `/api/states*` | Noun-per-entity read; write must warn it bypasses devices |
| Service calls | REST `/api/services/<domain>/<service>` | Verb-first call with typed args from service descriptions |
| Templates | REST `/api/template` | One-shot `render` verb |
| History | REST `/api/history/period` | Time-window noun with sensible defaults |
| Logbook | REST `/api/logbook` | Same |
| Statistics | WebSocket only | First-class CLI surface (REST lacks it entirely) |
| Registries (area/device/entity/floor/label) | WebSocket only, admin-gated | Read nouns are cheap wins; writes need admin warning |
| Zones | WebSocket storage collection, admin-gated | Same |
| Events (list/fire) | REST | Low priority |
| Config check | REST `check_config` | Useful `check` verb |
| Control via LLM | MCP server (2025.2+) | Complementary, not competing: MCP = conversational, CLI = deterministic/scripted |

## Gap list (what no existing surface gives an agent)

1. Registry and statistics access via HTTP — WebSocket-only today; a CLI should bridge these to simple verbs.
2. Pagination/filtering — none server-side; client-side filtering is mandatory ergonomics work.
3. Uniform errors — REST error bodies vary per endpoint class; normalize into one shape.
4. Token scoping — LLATs are all-or-nothing; CLI docs must make blast radius explicit.
5. Deterministic non-LLM control — MCP covers conversational control only; nothing ships an agent-first scripted interface.
6. hass-cli exists but targets humans; no maintained agent-oriented CLI.

## Source links

- REST API: https://developers.home-assistant.io/docs/api/rest/
- Auth API / long-lived tokens: https://developers.home-assistant.io/docs/auth_api/
- MCP Server integration: https://www.home-assistant.io/integrations/mcp_server/
- mcp_server manifest: https://github.com/home-assistant/core/blob/dev/homeassistant/components/mcp_server/manifest.json
- Registry-as-websocket evidence: https://github.com/home-assistant/core/blob/dev/homeassistant/components/config/area_registry.py
- Statistics-as-websocket evidence: https://github.com/home-assistant/core/blob/dev/homeassistant/components/recorder/websocket_api.py
- hass-cli: https://github.com/home-assistant-ecosystem/home-assistant-cli
- AXI catalog: https://github.com/kunchenguid/axi/blob/main/catalog.yaml
