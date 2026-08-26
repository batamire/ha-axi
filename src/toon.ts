import { encode, type JsonValue } from "@toon-format/toon";

export type Row = Record<string, unknown>;

/** Pick a fixed field map off a source object (TOON field map extraction). */
export function extract(item: Record<string, unknown>, fields: string[]): Row {
  const row: Row = {};
  for (const f of fields) row[f] = item[f];
  return row;
}

/** Encode a list of rows under a label key. */
export function renderList(label: string, items: Row[]): string {
  return encode({ [label]: items });
}

/** Encode a single detail object. */
export function renderDetail(detail: Row): string {
  return encode(detail);
}

/** `help[N]:\n  <line>` block per the #5 prototype shape. */
export function renderHelp(lines: string[]): string {
  if (lines.length === 0) return "";
  return `help[${lines.length}]:\n  ${lines.join("\n  ")}`;
}

/** Structured error: TOON `{error, code}` + optional help block. */
export function renderError(message: string, code: string, suggestions?: string[]): string {
  const body = encode({ error: message, code });
  const help = suggestions && suggestions.length > 0 ? `\n${renderHelp(suggestions)}` : "";
  return `${body}${help}`;
}

/** Relative time: <60m → `Nm`, <24h → `Nh`, else `Nd`. */
export function relTime(iso: string, now: number = Date.now()): string {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (diffMin < 60) return `${Math.max(diffMin, 0)}m`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / 1440)}d`;
}

export const TRUNCATE_LIMIT = 8000;

/**
 * Truncate long field values to the first 8000 chars plus an explicit
 * marker naming what was cut and how to get it back.
 */
export function truncate(value: unknown, max: number = TRUNCATE_LIMIT): unknown {
  if (typeof value !== "string" || value.length <= max) return value;
  const cut = value.length - max;
  return `${value.slice(0, max)}... [truncated ${cut} chars, use --full]`;
}

export type { JsonValue };
