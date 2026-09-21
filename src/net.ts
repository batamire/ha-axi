import { urlCandidates, type ResolvedConfig } from "./config.js";

/**
 * Shared transport-failure diagnostics for the REST and WebSocket paths.
 *
 * Node's fetch (undici) rejects every transport failure with the literal
 * message "fetch failed" and hides the real reason on `err.cause` (a code
 * and/or message, sometimes an AggregateError of per-address failures). Node's
 * native WebSocket is worse: its `error` event carries an opaque TypeError, so
 * the close code is often the only detail available. These helpers extract
 * whatever the runtime exposes so both transports read alike.
 */

/** The undici message that carries no information by itself. */
export const FETCH_FAILED = "fetch failed";

/** TLS-ish wording, including the OpenSSL codes undici puts on `cause.code`. */
const TLS_HINT = /certificate|self-signed|unable to verify|TLS|SSL|_CERT\b|CERT_|ERR_TLS/i;

const MAX_CAUSE_DEPTH = 3;

/** Shape of a fetch failure `cause`: an Error with `code`, or an AggregateError. */
export type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  errors?: unknown;
};

/** Abort/timeout surfaces as AbortError, TimeoutError, or an undici error code. */
export function isAbortLike(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { name, code } = e as ErrorLike;
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    code === "ABORT_ERR" ||
    code === "UND_ERR_ABORTED" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT"
  );
}

/**
 * Flatten `err.cause` into one line: code and/or message, following nested
 * causes and AggregateError members (multi-address hosts fail per address).
 */
export function describeCause(cause: unknown, depth = 0): string {
  if (cause === undefined || cause === null || depth > MAX_CAUSE_DEPTH) return "";
  if (typeof cause !== "object") return String(cause);
  const e = cause as ErrorLike;

  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const parts = [
      ...new Set(e.errors.map((child) => describeCause(child, depth + 1)).filter(Boolean)),
    ];
    if (parts.length > 0) return parts.join("; ");
  }

  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  // Avoid "ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:55590"-style noise.
  const own =
    code && message && message.toUpperCase().includes(code.toUpperCase())
      ? message
      : [code, message].filter(Boolean).join(": ");
  const nested = describeCause(e.cause, depth + 1);
  return [own, nested].filter(Boolean).join("; ");
}

/**
 * Join an error's own message with its cause detail, dropping the useless
 * literal `fetch failed` when the cause explains the failure.
 */
export function foldDetail(base: string, detail: string): string {
  const keepBase = base && base !== FETCH_FAILED && !(detail && detail.includes(base)) ? base : "";
  return [keepBase, detail].filter(Boolean).join(": ") || "connection failed";
}

export type TransportFailure = {
  /** Human-readable detail, safe to embed once scrubbed. */
  text: string;
  /** Aborted / timed out rather than refused or unresolved. */
  timedOut: boolean;
  /** Certificate-verification wording (or its OpenSSL code). */
  tls: boolean;
};

/** Classify a thrown transport error into text + timeout/TLS flags. */
export function classifyTransport(err: unknown): TransportFailure {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const detail = describeCause(cause);
  const rawMessage = (err as ErrorLike | null)?.message;
  const base = typeof rawMessage === "string" ? rawMessage.trim() : "";
  let text = foldDetail(base, detail);
  const timedOut = isAbortLike(err) || isAbortLike(cause) || /abort/i.test(text);
  const tls = TLS_HINT.test(text);
  if (timedOut && !/abort|timed?\s?out/i.test(text)) text = `timed out (${text})`;
  return { text, timedOut, tls };
}

/** True when the text looks like a certificate/TLS verification failure. */
export function looksLikeTlsFailure(text: string): boolean {
  return TLS_HINT.test(text);
}

/** Tokens never appear anywhere in output — scrub them from any message. */
export function scrub(message: string, ...secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s) out = out.split(s).join("[redacted]");
  }
  return out;
}

/**
 * Credentials embedded in candidate URLs (fetch rejects such URLs, but the
 * rejection message echoes them). Collected so they can be scrubbed too.
 */
export function urlSecrets(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      for (const part of [u.username, u.password]) {
        const decoded = safeDecode(part);
        if (decoded) out.push(decoded);
      }
    } catch {
      // unparseable candidate: nothing to extract
    }
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** URL without credentials, query, or fragment — safe to echo in logs/errors. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "") || url;
  } catch {
    return "<invalid-url>";
  }
}

export type CandidateNotes = {
  /** A candidate failed at transport level, before any HTTP answer. */
  failed(index: number, total: number, url: string, detail: string): void;
  /** A candidate answered; `viaFallback` marks that earlier candidates failed. */
  using(index: number, total: number, url: string, viaFallback: boolean): void;
};

/**
 * stderr reporter for candidate selection. stdout (the TOON contract) is never
 * touched. A single candidate stays silent unless `verbose` — legacy behaviour
 * is byte-identical. With several candidates, fallbacks are always announced;
 * `--verbose` also traces the happy path and each failure.
 */
export function candidateNotes(cfg: ResolvedConfig): CandidateNotes {
  const verbose = cfg.verbose === true;
  const say = (line: string): void => {
    process.stderr.write(`ha-axi: ${line}\n`);
  };
  const secrets = [cfg.token, ...urlSecrets(urlCandidates(cfg))];
  const safe = (text: string): string => scrub(text, ...secrets);
  return {
    failed(index, total, url, detail) {
      if (total === 1 && !verbose) return;
      say(`candidate ${index + 1}/${total} ${safe(redactUrl(url))} unreachable: ${safe(detail)}`);
    },
    using(index, total, url, viaFallback) {
      if (!verbose && !viaFallback) return;
      const suffix = viaFallback ? " (fallback)" : "";
      say(`using candidate ${index + 1}/${total}: ${safe(redactUrl(url))}${suffix}`);
    },
  };
}
