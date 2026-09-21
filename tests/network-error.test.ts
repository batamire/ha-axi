// Transport-failure classification: Node's fetch always rejects with the
// literal message "fetch failed" and hides the reason on `err.cause`. These
// tests pin the cause-derived detail and the TLS/timeout branches that used to
// be unreachable because they only inspected err.message.
import { afterEach, describe, expect, it } from "vitest";
import type { AxiError } from "axi-sdk-js";
import { HaClient } from "../dist/ha.js";
import type { ResolvedConfig } from "../dist/config.js";

function cfg(url: string, token = "synthetic-token"): ResolvedConfig {
  return {
    url,
    urls: [url],
    token,
    profile: "test",
    timeoutMs: 5_000,
    insecure: false,
    verbose: false,
  };
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Make the next fetch reject with an undici-shaped `TypeError: fetch failed`. */
function rejectWith(cause: unknown): void {
  const err = Object.assign(new TypeError("fetch failed"), { cause });
  globalThis.fetch = (() => Promise.reject(err)) as typeof fetch;
}

/** `client.get` cannot succeed here; return the AxiError it throws. */
async function getFailure(client: HaClient): Promise<AxiError> {
  return client.get("/api/").then(
    () => {
      throw new Error("expected get() to reject");
    },
    (e: AxiError) => e,
  );
}

describe("network failure classification", () => {
  it("surfaces the cause and keeps NODE_EXTRA_CA_CERTS for TLS failures", async () => {
    rejectWith(
      Object.assign(new Error("self-signed certificate"), {
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      }),
    );

    const failure = await getFailure(new HaClient(cfg("https://hass.example")));
    expect(failure.code).toBe("CONNECTION_FAILED");
    expect(failure.message).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(failure.message).toContain("self-signed certificate");
    expect(failure.message).not.toContain("timed out");
    expect(failure.suggestions.join(" ")).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("distinguishes a DNS failure from a refused-connection message", async () => {
    rejectWith(
      Object.assign(new Error("getaddrinfo ENOTFOUND nope.invalid"), { code: "ENOTFOUND" }),
    );

    const failure = await getFailure(new HaClient(cfg("http://nope.invalid:8123")));
    expect(failure.code).toBe("CONNECTION_FAILED");
    expect(failure.message).toContain("ENOTFOUND");
    expect(failure.message).toContain("nope.invalid");
    expect(failure.suggestions.join(" ")).not.toContain("NODE_EXTRA_CA_CERTS");
  });

  it("scrubs the token out of cause-derived detail", async () => {
    rejectWith(new Error("connect failed using token synthetic-token"));

    const failure = await getFailure(new HaClient(cfg("https://hass.example")));
    expect(failure.message).not.toContain("synthetic-token");
    expect(failure.message).toContain("[redacted]");
  });

  it("classifies a TimeoutError nested in the cause as a timeout", async () => {
    rejectWith(
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );

    const failure = await getFailure(new HaClient(cfg("https://hass.example")));
    expect(failure.code).toBe("CONNECTION_FAILED");
    expect(failure.message).toContain("timed out");
  });
});
