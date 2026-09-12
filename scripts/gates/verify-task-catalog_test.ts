/**
 * Fixture tests for the task-catalog gate. Each case builds a minimal skeleton
 * repository in a temp dir, copies the gate next to it, and runs it as a
 * subprocess, proving both the pass path and the two failure directions
 * (uncited task, stale catalog bullet).
 */
import { assert, assertStringIncludes } from "@std/assert";

const GATE_SOURCE = await Deno.readTextFile(
  new URL("./verify-task-catalog.ts", import.meta.url),
);

interface GateResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runGate(
  denoJson: string,
  catalog: string,
): Promise<GateResult> {
  const dir = await Deno.makeTempDir({ prefix: "task-catalog-gate-" });
  try {
    await Deno.mkdir(`${dir}/docs/reference/runtime`, { recursive: true });
    await Deno.mkdir(`${dir}/scripts/gates`, { recursive: true });
    await Deno.writeTextFile(`${dir}/deno.json`, denoJson);
    await Deno.writeTextFile(
      `${dir}/docs/reference/runtime/task-catalog.md`,
      catalog,
    );
    const gatePath = `${dir}/scripts/gates/verify-task-catalog.ts`;
    await Deno.writeTextFile(gatePath, GATE_SOURCE);
    const out = await new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-prompt", "--allow-read", gatePath],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = new TextDecoder();
    return {
      code: out.code,
      stdout: decode.decode(out.stdout),
      stderr: decode.decode(out.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const PASS_DENO_JSON = JSON.stringify({
  tasks: { alpha: "echo alpha", "beta:task": "echo beta" },
});
const PASS_CATALOG = [
  "# Task catalog",
  "",
  "- `alpha` — first fixture task.",
  "- `beta:task` — second fixture task.",
  "",
].join("\n");

Deno.test("task-catalog gate passes when every task is cited", async () => {
  const result = await runGate(PASS_DENO_JSON, PASS_CATALOG);
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
  assertStringIncludes(result.stdout, "Verified 2 deno.json task(s)");
});

Deno.test("task-catalog gate fails on an uncited task", async () => {
  const catalog = [
    "# Task catalog",
    "",
    "- `alpha` — first fixture task.",
    "",
  ].join("\n");
  const result = await runGate(PASS_DENO_JSON, catalog);
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "beta:task");
});

Deno.test("task-catalog gate fails on a stale bullet", async () => {
  const catalog = [
    "# Task catalog",
    "",
    "- `alpha` — first fixture task.",
    "- `beta:task` — second fixture task.",
    "- `removed:task` — stale row for a deleted task.",
    "",
  ].join("\n");
  const result = await runGate(PASS_DENO_JSON, catalog);
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "removed:task");
  assertStringIncludes(result.stderr, "missing from deno.json");
});
