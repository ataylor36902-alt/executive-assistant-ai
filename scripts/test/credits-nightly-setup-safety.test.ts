import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function tomlAssignment(
  source: string,
  section: string,
  key: string,
): string {
  let currentSection = "";
  for (const line of source.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (currentSection !== section) continue;
    const assignment = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`));
    if (assignment) return assignment[1];
  }
  throw new Error(`Missing ${section || "top-level"} ${key} setting`);
}

function tomlStringArray(source: string, section: string, key: string): string[] {
  const value = JSON.parse(tomlAssignment(source, section, key)) as unknown;
  assert.ok(Array.isArray(value) && value.every((item) => typeof item === "string"));
  return value;
}

function allFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", ".cache", ".local", "node_modules"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return allFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

test("staged Run and Scheduled commands only install dependencies and start the guarded scheduler", () => {
  const repl = readProjectFile(".replit");
  const template = readProjectFile("ops/credits-nightly/scheduled-project.replit.toml");
  const runScript = ["pnpm", "--filter", "@workspace/scripts", "nightly-classscribe-credits"];
  const shellBuild = ["sh", "-c", "pnpm install --frozen-lockfile"];
  const shellRun = ["sh", "-c", "pnpm --filter @workspace/scripts nightly-classscribe-credits"];

  assert.deepEqual(tomlStringArray(repl, "", "run"), runScript);
  assert.equal(JSON.parse(tomlAssignment(repl, "deployment", "deploymentTarget")), "scheduled");
  assert.deepEqual(tomlStringArray(repl, "deployment", "build"), shellBuild);
  assert.deepEqual(tomlStringArray(repl, "deployment", "run"), shellRun);

  assert.equal(JSON.parse(tomlAssignment(template, "deployment", "deploymentTarget")), "scheduled");
  assert.deepEqual(tomlStringArray(template, "deployment", "build"), shellBuild);
  assert.deepEqual(tomlStringArray(template, "deployment", "run"), shellRun);

  const scripts = JSON.parse(readProjectFile("scripts/package.json")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    scripts.scripts["nightly-classscribe-credits"],
    "tsx src/run-nightly-classscribe-credits.ts",
  );
  assert.equal(scripts.scripts["prenightly-classscribe-credits"], undefined);
  assert.equal(scripts.scripts["postnightly-classscribe-credits"], undefined);
});

test("post-merge hook has no app launch, schema, migration, seed, or provider mutation commands", () => {
  const executableLines = readProjectFile("scripts/post-merge.sh")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(executableLines, [
    "set -euo pipefail",
    "pnpm install --frozen-lockfile",
  ]);
});

test("dependency installation has no hidden workspace lifecycle launch or mutation hooks", () => {
  const lifecycleNames = new Set(["preinstall", "install", "postinstall", "prepare"]);
  const hooks = allFiles(root)
    .filter((path) => basename(path) === "package.json")
    .flatMap((path) => {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        scripts?: Record<string, string>;
      };
      return Object.entries(manifest.scripts ?? {})
        .filter(([name]) => lifecycleNames.has(name))
        .map(([name, command]) => ({ path: relative(root, path), name, command }));
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));

  assert.deepEqual(hooks, [{
    path: "package.json",
    name: "preinstall",
    command: "sh -c 'rm -f package-lock.json yarn.lock; case \"$npm_config_user_agent\" in pnpm/*) ;; *) echo \"Use pnpm instead\" >&2; exit 1 ;; esac'",
  }]);
});

test("all artifact metadata stays archived outside active artifact registration locations", () => {
  const archivedRoot = join(root, "ops/credits-nightly/reference-artifacts");
  const activeArtifactsRoot = join(root, "artifacts");
  const isArtifactMetadata = (path: string) =>
    basename(path) === "artifact.toml" || basename(path) === "artifact.root-candidate.toml";
  const archived = allFiles(archivedRoot).filter(isArtifactMetadata).map((path) => resolve(path)).sort();
  const active = allFiles(activeArtifactsRoot)
    .filter(isArtifactMetadata)
    .map((path) => relative(root, path))
    .sort();
  const elsewhere = allFiles(root)
    .filter((path) => !path.startsWith(`${join(root, "node_modules")}/`))
    .filter((path) => !path.startsWith(`${join(root, ".git")}/`))
    .filter(isArtifactMetadata)
    .map((path) => resolve(path))
    .filter((path) => !path.startsWith(`${resolve(archivedRoot)}/`))
    .sort();

  assert.ok(archived.length > 0, "the imported artifact references should remain available in the archive");
  assert.deepEqual(active, [], "copied artifact metadata must not be registered under artifacts/");
  assert.deepEqual(elsewhere, [], "artifact metadata must remain in the inert reference archive");
});

test("the runner passes only the dedicated database target and requires read-only sessions", () => {
  const runner = readProjectFile("scripts/src/run-nightly-classscribe-credits.ts");
  const reconciler = readProjectFile("scripts/src/reconcile-classscribe-credits.ts");
  const environmentGuards = readProjectFile("scripts/src/credits-nightly-report.ts");

  assert.match(
    runner,
    /DATABASE_URL:\s*process\.env\.CREDITS_RECONCILIATION_DATABASE_URL/,
    "the scheduler-managed DATABASE_URL must never be the fallback target",
  );
  assert.doesNotMatch(runner, /DATABASE_URL:\s*process\.env\.DATABASE_URL\b/);
  assert.match(runner, /default_transaction_read_only=on/);
  assert.match(runner, /CREDITS_RECONCILIATION_READ_ONLY_REQUIRED:\s*"1"/);
  assert.match(
    environmentGuards,
    /env\.DATABASE_URL\s*===\s*env\.CREDITS_RECONCILIATION_DATABASE_URL/,
  );

  const mainFunction = reconciler.slice(
    reconciler.indexOf("async function main(): Promise<void>"),
  );
  const directEntryGuard = mainFunction.indexOf(
    "if (!validateNightlyReconcilerEnvironment(process.env))",
  );
  const firstDatabaseAccess = mainFunction.indexOf("pool.query");
  assert.ok(directEntryGuard >= 0 && directEntryGuard < firstDatabaseAccess);
  assert.match(reconciler, /show default_transaction_read_only/);
});
