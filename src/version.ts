// Reported by `ha-axi --version`.
//
// Single source of truth: package.json. release-please bumps it on every
// release and npm always ships it, so this file holds no version string of its
// own and cannot drift. This replaces the previous hand-maintained constant +
// `x-release-please-version` annotation + `extra-files` entry in
// release-please-config.json, a sync that failed silently (release-please PR
// #19 bumped package.json and left this file stale, so the CLI kept reporting
// the previous release).
//
// The path assumes plain `tsc` output (rootDir `src` -> outDir `dist`), so this
// file sits one level below the package root both in the repo and in an
// installed package. If the CLI is ever bundled into a single file, replace
// this with build-time injection (`define`) — and note that it fails loudly
// rather than silently reporting a stale version.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const VERSION = pkg.version;
