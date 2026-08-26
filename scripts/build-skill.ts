#!/usr/bin/env tsx
// Generates skills/ha-axi/SKILL.md from src/skill.ts (which derives the
// Commands block from the CLI's COMMAND_SUMMARY) so the installable skill
// never drifts from what `ha-axi --help` prints.
//
//   pnpm run build:skill            # write the file
//   pnpm run build:skill -- --check # fail (exit 1) if the committed file is stale
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createSkillMarkdown } from "../src/skill.js";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const outDir = join(root, "skills/ha-axi");
const out = join(outDir, "SKILL.md");
const expected = createSkillMarkdown();
const check = process.argv.includes("--check");

if (check) {
  let actual: string | null = null;
  try {
    actual = readFileSync(out, "utf-8");
  } catch {
    // missing file falls through to the mismatch branch below
  }
  if (actual !== expected) {
    console.error("skills/ha-axi/SKILL.md is out of date. Run `pnpm run build:skill` and commit the result.");
    process.exit(1);
  }
  console.log("skills/ha-axi/SKILL.md is up to date.");
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, expected, "utf-8");
  console.log(`built skill: ${out}`);

  // dist/skills copy + manifest for release packaging (`files` includes dist)
  if (existsSync(join(root, "dist"))) {
    const distDir = join(root, "dist/skills/ha-axi");
    mkdirSync(distDir, { recursive: true });
    copyFileSync(out, join(distDir, "SKILL.md"));
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const manifest = {
      name: "ha-axi",
      description: pkg.description,
      version: pkg.version,
      entry: "SKILL.md",
    };
    writeFileSync(join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }
}
