/**
 * Architecture boundary for the frozen thread-workflow prototype.
 *
 * WHY THIS TEST EXISTS — the engine in this directory deliberately has no
 * production lifecycle (no claim/lease, no WAL, no capture persistence, no
 * snapshot publication, no MRTR gate). A reviewed design decision (2026-08-09)
 * froze it as an authoring prototype in favour of server-fixed registered
 * executors. Contributor guidance alone did not hold that line once before — it
 * drifted into claiming the backend executes this DAG — so the boundary is
 * enforced here: no production module may import from
 * experiments/thread-workflow/. A documentary path reference (a string naming
 * a reviewed YAML fixture) is allowed; an import
 * would wire the engine into a lifecycle it does not implement.
 */

import { assertEquals } from "@std/assert";

const PRODUCTION_ROOTS = ["src", "scripts"] as const;

/**
 * Three import forms can wire the prototype in: `from "..."`, a dynamic
 * `import("...")`, and a bare side-effect `import "..."`. A documentary path
 * string (no import keyword) matches none of them.
 */
const IMPORT_OF_PROTOTYPE =
  /(?:from\s*|import\s*\(\s*|import\s+)["'][^"']*thread-workflow/;

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...await collectTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

Deno.test("no production module imports the frozen thread-workflow prototype", async () => {
  const files = ["server.ts"];
  for (const root of PRODUCTION_ROOTS) {
    files.push(...await collectTypeScriptFiles(root));
  }
  const offenders: string[] = [];
  for (const file of files) {
    const source = await Deno.readTextFile(file);
    if (IMPORT_OF_PROTOTYPE.test(source)) {
      offenders.push(file);
    }
  }
  assertEquals(
    offenders,
    [],
    "The thread-workflow engine is a frozen prototype without a production " +
      "lifecycle; these files import it and would execute provider calls " +
      "outside the trusted executor template: " + offenders.join(", "),
  );
});
