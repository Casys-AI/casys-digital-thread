/**
 * Pins the scripts/ entry-point index so it cannot drift silently.
 *
 * Three invariants are checked:
 *
 * 1. Every non-test entry-point file under scripts/ (excluding scripts/lib/)
 *    is referenced in scripts/README.md.  A new entry point that is not
 *    indexed breaks this test.
 *
 * 2. Every `deno task` name cited inside README.md exists as a key in
 *    deno.json.  A task renamed or removed from deno.json breaks this test.
 *
 * 3. Every `scripts/…` path that appears inside a `deno run` or `deno check`
 *    invocation in deno.json points to a file that exists on disk.  A script
 *    moved without updating deno.json breaks this test.
 *
 * The model for this suite is src/orchestration/operations/operation-reference-docs_test.ts.
 */
import { assert, assertEquals } from "@std/assert";

const REPO_ROOT = new URL("../", import.meta.url);
const SCRIPTS_DIR = new URL("./", import.meta.url);
const README_PATH = new URL("README.md", SCRIPTS_DIR);
const DENO_JSON_PATH = new URL("../deno.json", SCRIPTS_DIR);

// ---------------------------------------------------------------------------
// Read sources
// ---------------------------------------------------------------------------

const README = await Deno.readTextFile(README_PATH);
const DENO_JSON = JSON.parse(await Deno.readTextFile(DENO_JSON_PATH)) as {
  tasks: Record<string, string>;
};

// ---------------------------------------------------------------------------
// 1. Discover entry-point files under scripts/ (non-test, non-lib)
// ---------------------------------------------------------------------------

/**
 * A role directory with no entry point does not exist in a fresh checkout:
 * git does not carry empty directories, so `scripts/runners/` is present on a
 * machine that once held runners and absent everywhere else. Treating that as
 * "no entry points" keeps the index assertions meaningful; throwing made the
 * suite pass locally and fail on a clean clone.
 */
async function collectEntryPoints(dir: string | URL): Promise<string[]> {
  const results: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith("_test.ts")) continue;
      results.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return results.sort();
}

const SUB_ROLES = ["runners", "gates", "probes", "release", "serve"] as const;
// release/source-alpha-inventory.ts is a shared deterministic renderer invoked by
// the three public release entry points. It is deliberately not directly runnable.
const NON_ENTRY_POINT_FILES = new Set(["release/source-alpha-inventory.ts"]);

const allEntryPoints: { role: string; file: string }[] = [];
for (const role of SUB_ROLES) {
  const dir = new URL(`${role}/`, SCRIPTS_DIR);
  const files = await collectEntryPoints(dir);
  for (const f of files) {
    if (NON_ENTRY_POINT_FILES.has(`${role}/${f}`)) continue;
    allEntryPoints.push({ role, file: `${role}/${f}` });
  }
}

// ---------------------------------------------------------------------------
// 2. Extract task names cited in README.md
// ---------------------------------------------------------------------------

const TASK_PATTERN = /`([\w:]+)`/g;
const citedTasks = new Set<string>();
for (const match of README.matchAll(TASK_PATTERN)) {
  const candidate = match[1];
  // Task names contain ":" and are not file paths or code snippets
  if (candidate.includes(":") && !candidate.includes("/")) {
    citedTasks.add(candidate);
  }
}

// ---------------------------------------------------------------------------
// 3. Extract scripts/ file paths cited by deno run/check in deno.json
// ---------------------------------------------------------------------------

// Non-glob scripts/ paths in deno.json task values (excludes patterns like **/*_test.ts)
const SCRIPTS_PATH_PATTERN = /scripts\/[^\s"*]+\.ts/g;
const citedScriptPaths = new Set<string>();
for (const cmd of Object.values(DENO_JSON.tasks)) {
  for (const match of cmd.matchAll(SCRIPTS_PATH_PATTERN)) {
    citedScriptPaths.add(match[0]);
  }
}

// ---------------------------------------------------------------------------
// Test 1: every entry-point appears in README.md
// ---------------------------------------------------------------------------

Deno.test(
  "scripts/README.md references every entry-point file under scripts/",
  () => {
    const missing = allEntryPoints
      .map((ep) => ep.file)
      .filter((f) => !README.includes(f));
    assertEquals(
      missing,
      [],
      `The following entry-point files are missing from scripts/README.md: ` +
        `${missing.join(", ")}. Add a row for each.`,
    );
  },
);

// ---------------------------------------------------------------------------
// Test 2: every task cited in README.md exists in deno.json
// ---------------------------------------------------------------------------

Deno.test(
  "every deno task cited in scripts/README.md exists in deno.json",
  () => {
    const registeredTasks = new Set(Object.keys(DENO_JSON.tasks));
    const dead = [...citedTasks].filter((t) => !registeredTasks.has(t));
    assertEquals(
      dead,
      [],
      `scripts/README.md cites tasks that do not exist in deno.json: ` +
        `${dead.join(", ")}. Either rename the task or update the README.`,
    );
    assert(
      citedTasks.size > 0,
      "scripts/README.md no longer cites any task names. Either the file lost " +
        "its content or this test must be updated.",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 3: every scripts/ path in deno.json points to an existing file
// ---------------------------------------------------------------------------

Deno.test(
  "every scripts/ path cited in deno.json tasks points to an existing file",
  async () => {
    const dead: string[] = [];
    for (const scriptPath of citedScriptPaths) {
      const abs = new URL(scriptPath, REPO_ROOT);
      try {
        await Deno.stat(abs);
      } catch {
        dead.push(scriptPath);
      }
    }
    assertEquals(
      dead,
      [],
      `deno.json cites scripts/ paths that do not exist on disk: ` +
        `${dead.join(", ")}. Update deno.json or restore the missing file.`,
    );
  },
);
