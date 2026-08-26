import { describe, expect, it } from "vitest";
import { relTime, truncate, renderHelp, renderError, extract } from "../src/toon.js";

describe("truncate", () => {
  it("passes through short values untouched", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate(42)).toBe(42);
    expect(truncate(null)).toBe(null);
  });

  it("cuts long values at the limit and names the remedy", () => {
    const long = "x".repeat(9_000);
    const out = truncate(long) as string;
    expect(out.startsWith("x".repeat(8_000))).toBe(true);
    expect(out).toContain("[truncated 1000 chars, use --full]");
  });

  it("leaves values exactly at the limit alone", () => {
    const exact = "y".repeat(8_000);
    expect(truncate(exact)).toBe(exact);
  });
});

describe("relTime", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");
  it("renders minutes under an hour", () => {
    expect(relTime(new Date(now - 42 * 60_000).toISOString(), now)).toBe("42m");
  });

  it("renders hours under a day", () => {
    expect(relTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h");
  });

  it("renders days beyond that", () => {
    expect(relTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d");
  });
});

describe("renderers", () => {
  it("help block carries its line count", () => {
    expect(renderHelp(["a next step", "another"])).toBe("help[2]:\n  a next step\n  another");
  });

  it("error output pairs message with code and suggestions", () => {
    const out = renderError("nope", "DOMAIN_EXCLUDED", ["check state read-only"]);
    expect(out).toContain("DOMAIN_EXCLUDED");
    expect(out).toContain("help[1]:");
  });

  it("extract picks only the field map", () => {
    const row = extract({ id: "light.kitchen", name: "Kitchen", extra: "dropped" }, [
      "id",
      "name",
    ]);
    expect(row).toEqual({ id: "light.kitchen", name: "Kitchen" });
  });
});
