#!/usr/bin/env node
// Resolve a task spec to the set of files an agent is allowed to touch, and
// write it to .task/allowed-files.json (read by the scope-guard hook).
//
// Deterministic lookup first: any argument that is a known module name (or a
// spec file that mentions known module names) expands to that module's glob
// straight from module-map.json — no guessing.
//
// Agent-assist fallback: an argument that resolves to nothing recognisable is
// kept verbatim as a path glob and flagged, so a human/agent can confirm it.
//
// Usage:
//   npm run scope frontend/src/lib         # allow edits under that path (glob)
//   npm run scope .task/spec.md            # scan a spec file for module names
//   npm run scope frontend/src/lib/policy.js # literal path (fallback)
import {
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { appendRun } from "./edit-log.ts";

// Defaults to the real repo; SCOPE_ROOT lets tests run against a sandbox.
const ROOT = process.env.SCOPE_ROOT
  ? resolve(process.env.SCOPE_ROOT) + "/"
  : fileURLToPath(new URL("..", import.meta.url));
const mapPath = ROOT + "module-map.json";
const outPath = ROOT + ".task/allowed-files.json";
const branchPath = ROOT + ".task/branch";

// Module-map resolution is OPTIONAL: grant-trail has no module-map.json yet.
// When absent, module-name lookups simply find nothing and every argument is
// treated as a literal path/glob (the agent-assist fallback). If a
// module-map.json is later added, its modules become deterministic lookups.
type Module = { name: string; path: string; allowedImports?: string[] };
let modules: Module[] = [];
if (existsSync(mapPath)) {
  try {
    modules = (JSON.parse(readFileSync(mapPath, "utf8")).modules ??
      []) as Module[];
  } catch {
    modules = [];
  }
}
const byName = new Map(modules.map((m) => [m.name, m]));

const rawArgs = process.argv.slice(2);
const addMode = rawArgs.includes("--add");
const args = rawArgs.filter((a) => !a.startsWith("--"));
if (args.length === 0) {
  console.error("Usage: scope <module-name | spec-file | path> ... [--add]");
  process.exit(2);
}

// DEBT.md is seeded so logging tech debt never requires widening scope.
const SEEDED = [".task/**", "edit-log.jsonl", "DEBT.md"];
const CATCH_ALLS = new Set([
  "**",
  "*",
  "src/**",
  "src/*",
  "frontend/**",
  "frontend/src/**",
  "supabase/**",
]);
const allow = new Set<string>(SEEDED);
const fallbacks: string[] = [];
const matchedModules: string[] = [];

function addModule(m: Module): void {
  allow.add(`${m.path}/**`);
  matchedModules.push(m.name);
}

// The scope is tied to the branch it was created on. grant-trail has no
// slug-derived feature-branch flow (unlike upstream ai-first-starter, whose
// `pnpm pr` moves you onto `feature/<slug>`), so record the CURRENT git branch:
// that's what the scope-guard hook's branch-drift check compares against, so a
// scope created on your working branch stays active while you're on it and goes
// inactive once you switch away. Crash-safe: null (detached HEAD, no git) means
// "no branch recorded" and drift detection simply won't fire.
function currentBranch(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

for (const arg of args) {
  const mod = byName.get(arg);
  if (mod) {
    addModule(mod);
    continue;
  }
  if (existsSync(arg)) {
    // A directory: allow everything under it (a bare dir glob would only match
    // the dir itself, not its files). This is the common path-scope case in a
    // repo without a module-map — `npm run scope frontend/src/lib`.
    if (statSync(arg).isDirectory()) {
      const glob = `${arg.replace(/\/+$/, "")}/**`;
      allow.add(glob);
      fallbacks.push(glob);
      continue;
    }
    // A spec file: pull out any module names it mentions (deterministic).
    const text = readFileSync(arg, "utf8");
    const found = modules.filter((m) =>
      new RegExp(`\\b${m.name}\\b`).test(text),
    );
    if (found.length > 0) {
      found.forEach(addModule);
      // Additive, not exclusive: the literal path must unblock too, or
      // `npm run scope --add <blocked-file>` loops when the file names a module.
      allow.add(arg);
    } else {
      allow.add(arg);
      fallbacks.push(arg);
    }
    continue;
  }
  // Unknown token — agent-assist fallback: treat as a literal path glob.
  allow.add(arg);
  fallbacks.push(arg);
}

for (const entry of allow) {
  if (CATCH_ALLS.has(entry)) {
    console.error(
      `refusing catch-all scope "${entry}"; name modules or paths: npm run scope <module|path> [--add]`,
    );
    process.exit(2);
  }
}

if (!existsSync(ROOT + ".task")) mkdirSync(ROOT + ".task", { recursive: true });

let spec = args.join(" ");
let branch = currentBranch();
if (addMode && existsSync(outPath)) {
  const prev = JSON.parse(readFileSync(outPath, "utf8"));
  for (const entry of prev.allow ?? []) allow.add(entry);
  for (const m of prev.matchedModules ?? []) {
    if (!matchedModules.includes(m)) matchedModules.push(m);
  }
  spec = `${prev.spec} + ${spec}`;
  branch = prev.branch ?? branch;
}

const payload = {
  generatedAt: new Date().toISOString(),
  spec,
  matchedModules,
  allow: [...allow].sort(),
  branch,
};
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
if (branch) writeFileSync(branchPath, branch + "\n");
rmSync(ROOT + ".task/.unscoped-ack", { force: true });

console.log(`Wrote ${outPath}`);
console.log(
  `  matched modules: ${matchedModules.length ? matchedModules.join(", ") : "(none)"}`,
);
for (const f of fallbacks) {
  console.log(`  ⚠ fallback (verify manually): ${f}`);
}

appendRun({
  kind: "scope-set",
  add: addMode,
  args,
  matchedModules,
  fallbacks,
  branch,
});
