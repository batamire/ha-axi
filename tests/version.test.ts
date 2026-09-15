// Guards `ha-axi --version` against drifting from the released version.
//
// package.json is the single source of truth; src/version.ts reads it at
// runtime. This test runs the *built* binary (the CLI seam used by every test
// in this directory), so it also proves the runtime path resolution works in
// `dist/` — the one thing a unit import of VERSION would not catch.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

const pkgVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

describe("--version", () => {
  it("reports the version from package.json", async () => {
    const { status, stdout } = await runCli(["--version"]);

    expect(status).toBe(0);
    expect(stdout).toContain(pkgVersion);
  });

  it("keeps no hardcoded copy of the version in the source", () => {
    // The regression this guards: package.json bumped to 0.1.1 by
    // release-please while the CLI's own hardcoded copy stayed at 0.1.0. The
    // version module must hold no version literal, so no annotation or
    // `extra-files` sync is needed to keep it honest.
    const source = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");

    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(source).not.toMatch(/["'`]\d+\.\d+\.\d+/);
  });
});
