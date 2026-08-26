// Safety-posture metadata (#4 / ADR 0001) — deliberately dependency-free
// so it stays unit-testable without pulling in the REST client.
/** Domains whose mutations ha-axi refuses outright — no override in v1. */
export const GATED_DOMAINS: Record<string, true> = {
  lock: true,
  alarm_control_panel: true,
  cover: true,
};

/**
 * Curated idempotency classification for `service list` rows (advisory
 * metadata per ticket #4). Setters are idempotent; toggles/triggers/
 * scene/script/reload/fire are not.
 */
const IDEMPOTENT_RE = /^(turn_|set_|volume_|close|open$|stop|lock$|unlock$)/;

export function isIdempotentService(name: string): boolean {
  return IDEMPOTENT_RE.test(name);
}
