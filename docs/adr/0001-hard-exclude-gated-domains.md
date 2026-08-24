# 0001 — Hard-exclude gated domains from mutations

Date: 2026-08-24 · Status: accepted · Decided in [wayfinder ticket #4](https://github.com/batamire/ha-axi/issues/4)

## Context

ha-axi's only mutating verb is `service call`. Three domains act on
physical security surfaces — `lock` (door locks), `alarm_control_panel`
(arm/disarm), `cover` (garage doors, shutters) — where a mis-targeted or
mis-understood agent command has real-world consequences beyond an
inconvenient light state. The map's standing constraint required these to be
"gated"; the mechanism was open: explicit per-call unlock flag, config-file
allowlist, both, or hard exclusion.

## Decision

`service call` **refuses** `lock`, `alarm_control_panel`, and `cover`
outright with a structured `DOMAIN_EXCLUDED` error. No flag, no config file,
no override path in v1. State reads on those entities (`entity get`) remain
available, so "is the door locked?" still works — only the mutation is
absent.

Supporting posture decided alongside it:

- Non-concrete targets (`entity_id: all`, area/device bulk targeting) are
  refused by default (`BULK_TARGET_REFUSED`) with an explicit override flag.
- `--dry-run` prints the exact request (service, resolved targets, payload)
  and exits without firing.
- Errors use a status-based AxiError union (~9 codes incl.
  `DOMAIN_EXCLUDED`, `BULK_TARGET_REFUSED`), each with machine-readable code,
  human message, and next-step suggestions.

## Consequences

- Simplest possible safety story to document and test; nothing to leak,
  forget, or silently widen via setup hooks.
- Legitimate automation of locks/covers is impossible through ha-axi — users
  must fall back to direct HA access. Accepted: v1 optimizes for safe agent
  delegation over completeness.
- Reversal later means shipping a new minor version with an opt-in mechanism;
  cheap technically, but a public contract change once published.
