/**
 * Fixture tests for the task-catalog gate. Each case builds a minimal skeleton
 * repository in a temp dir, copies the gate next to it, and runs it as a
 * subprocess. The single authority is the first-column code span of true
 * pipe-table rows: prose and role-cell mentions never catalog a task.
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
  "- prose mention of `alpha` must not fail the reverse check.",
  "",
  "| Task | Role |",
  "| ---- | ---- |",
  "| `alpha` | First fixture task. |",
  "| `beta:task` | Second fixture task. |",
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
    "| Task | Role |",
    "| ---- | ---- |",
    "| `alpha` | First fixture task. |",
    "",
  ].join("\n");
  const result = await runGate(PASS_DENO_JSON, catalog);
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "beta:task");
});

Deno.test("task-catalog gate fails on a stale table row", async () => {
  const catalog = [
    "# Task catalog",
    "",
    "| Task | Role |",
    "| ---- | ---- |",
    "| `alpha` | First fixture task. |",
    "| `beta:task` | Second fixture task. |",
    "| `removed:task` | Stale row for a deleted task. |",
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

Deno.test(
  "task-catalog gate fails when a removed row leaves prose and role mentions",
  async () => {
    const catalog = [
      "# Task catalog",
      "",
      "Prose still mentions `beta:task` after its row was removed.",
      "",
      "| Task | Role |",
      "| ---- | ---- |",
      "| `alpha` | First fixture task; also mentions `beta:task` in this role. |",
      "",
    ].join("\n");
    const result = await runGate(PASS_DENO_JSON, catalog);
    assert(
      result.code === 1,
      `expected exit 1, got ${result.code}: ${result.stdout}`,
    );
    assertStringIncludes(result.stderr, "beta:task");
    assertStringIncludes(result.stderr, "first column");
  },
);

Deno.test(
  "task-catalog gate passes when prose alone mentions an unregistered task",
  async () => {
    const catalog = [
      "# Task catalog",
      "",
      "Prose mentions `removed:task`, which has no table row.",
      "",
      "| Task | Role |",
      "| ---- | ---- |",
      "| `alpha` | First fixture task. |",
      "| `beta:task` | Second fixture task. |",
      "",
    ].join("\n");
    const result = await runGate(PASS_DENO_JSON, catalog);
    assert(
      result.code === 0,
      `expected exit 0, got ${result.code}: ${result.stderr}`,
    );
    assertStringIncludes(result.stdout, "Verified 2 deno.json task(s)");
  },
);

Deno.test(
  "task-catalog gate fails when a task appears only as a fenced example row",
  async () => {
    const catalog = [
      "# Task catalog",
      "",
      "| Task | Role |",
      "| ---- | ---- |",
      "| `alpha` | First fixture task. |",
      "",
      "```md",
      "| `beta:task` | Example row that must not count. |",
      "```",
      "",
    ].join("\n");
    const result = await runGate(PASS_DENO_JSON, catalog);
    assert(
      result.code === 1,
      `expected exit 1, got ${result.code}: ${result.stdout}`,
    );
    assertStringIncludes(result.stderr, "beta:task");
    assertStringIncludes(result.stderr, "first column");
  },
);

Deno.test(
  "task-catalog gate passes when an unregistered row stays inside a fence",
  async () => {
    const catalog = [
      "# Task catalog",
      "",
      "| Task | Role |",
      "| ---- | ---- |",
      "| `alpha` | First fixture task. |",
      "| `beta:task` | Second fixture task. |",
      "",
      "```md",
      "| `removed:task` | Example row that must not fail the gate. |",
      "```",
      "",
    ].join("\n");
    const result = await runGate(PASS_DENO_JSON, catalog);
    assert(
      result.code === 0,
      `expected exit 0, got ${result.code}: ${result.stderr}`,
    );
    assertStringIncludes(result.stdout, "Verified 2 deno.json task(s)");
  },
);

Deno.test(
  "task-catalog gate fails when a task row is indented as a code block",
  async () => {
    const catalog = [
      "# Task catalog",
      "",
      "| Task | Role |",
      "| ---- | ---- |",
      "| `alpha` | First fixture task. |",
      "",
      "    | `beta:task` | Indented row that must not count. |",
      "",
    ].join("\n");
    const result = await runGate(PASS_DENO_JSON, catalog);
    assert(
      result.code === 1,
      `expected exit 1, got ${result.code}: ${result.stdout}`,
    );
    assertStringIncludes(result.stderr, "beta:task");
    assertStringIncludes(result.stderr, "first column");
  },
);

Deno.test("task-catalog gate keeps example rows fenced after incompatible closing lines", async () => {
  const catalog = [
    "# Task catalog",
    "",
    "| Task | Role |",
    "| ---- | ---- |",
    "| `alpha` | Real task. |",
    "",
    "````md",
    "```",
    "~~~~",
    "````md",
    "| `beta:task` | Still inside the example. |",
    "````",
    "",
  ].join("\n");
  const result = await runGate(PASS_DENO_JSON, catalog);
  assert(result.code === 1, `expected exit 1, got ${result.code}: ${result.stdout}`);
  assertStringIncludes(result.stderr, "beta:task");
});

Deno.test("task-catalog gate ignores standalone pipe-shaped prose", async () => {
  const catalog = [
    "# Task catalog",
    "",
    "| Task | Role |",
    "| --- | --- |",
    "| `alpha` | Registered task. |",
    "",
    "| `beta:task` | Standalone prose. |",
    "",
  ].join("\n");
  const result = await runGate(PASS_DENO_JSON, catalog);
  assert(result.code === 1, `expected exit 1, got ${result.code}: ${result.stdout}`);
  assertStringIncludes(result.stderr, "beta:task");
});
