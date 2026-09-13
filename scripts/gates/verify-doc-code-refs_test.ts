/**
 * Fixture tests for the doc-code-refs gate. Each case builds a minimal git
 * repository in a temp dir, copies the gate next to it, and runs it as a
 * subprocess: resolving refs pass, while missing targets, absolute
 * locators, and over-long fences behave as documented. Strict is the
 * default; the warn-mode production path is covered explicitly.
 */
import { assert, assertStringIncludes } from "@std/assert";

const GATE_SOURCE = await Deno.readTextFile(
  new URL("./verify-doc-code-refs.ts", import.meta.url),
);

interface GateResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runGate(
  files: Record<string, string>,
  mode: "strict" | "warn" = "strict",
): Promise<GateResult> {
  const dir = await Deno.makeTempDir({ prefix: "doc-code-refs-gate-" });
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = `${dir}/${rel}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), {
        recursive: true,
      });
      await Deno.writeTextFile(full, body);
    }
    await Deno.mkdir(`${dir}/scripts/gates`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/scripts/gates/verify-doc-code-refs.ts`,
      GATE_SOURCE,
    );
    const init = await new Deno.Command("git", {
      args: ["init", "-q"],
      cwd: dir,
      stdout: "null",
      stderr: "null",
    }).output();
    assert(init.success, "fixture git init failed");
    const out = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        "--allow-read",
        "--allow-run=git",
        `${dir}/scripts/gates/verify-doc-code-refs.ts`,
        `--mode=${mode}`,
      ],
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

const SOURCE = "export const ok = 1;\n";

Deno.test("doc-code-refs gate passes on resolving refs", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\nSee `src/ok.ts:1`.\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
  assertStringIncludes(result.stdout, "Verified 1 code references");
});

Deno.test("doc-code-refs gate fails on a missing target", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\nSee `src/gone.ts:1`.\n",
  });
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "src/gone.ts:1");
});

Deno.test("doc-code-refs gate reports an absolute locator as escaped", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\nSee `/tmp/absent.ts:1`.\n",
  });
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "escapes the repository");
});

Deno.test("doc-code-refs gate skips long shell fences", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\n````bash\n$ grep `src/gone.ts:1` log\n````\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate keeps exit 0 with a report in warn mode", async () => {
  const result = await runGate(
    {
      "src/ok.ts": SOURCE,
      "doc.md": "# Doc\n\nSee `src/gone.ts:1`.\n",
    },
    "warn",
  );
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
  assertStringIncludes(result.stderr, "src/gone.ts:1");
  assertStringIncludes(result.stdout, "1 unresolvable");
  assertStringIncludes(result.stdout, "(warn mode)");
});

Deno.test("doc-code-refs gate ignores a shorter backtick line inside a long shell fence", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n````bash\n$ grep `src/gone.ts:1` log\n```\n$ grep `src/gone.ts:1` again\n````\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate ignores a mismatched tilde line inside a backtick shell fence", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n```bash\n$ grep `src/gone.ts:1` log\n~~~\n$ grep `src/gone.ts:1` again\n```\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate ignores a fence line carrying info text inside a shell fence", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n````bash\n$ grep `src/gone.ts:1` log\n````bash\n$ grep `src/gone.ts:1` again\n````\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate closes a tilde shell fence with a longer matching fence", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n~~~bash\n$ grep `src/gone.ts:1` log\n~~~~\n\nSee `src/gone.ts:1`.\n",
  });
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "src/gone.ts:1");
});

Deno.test("doc-code-refs gate ignores a quoted shell example", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\n> ```bash\n> $ grep `src/gone.ts:1` log\n> ```\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate ignores a nested quoted shell example", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\n>> ```bash\n>> $ grep `src/gone.ts:1` log\n>> ```\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate still fails outside a closed quoted block", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n> ```bash\n> $ grep `src/gone.ts:1` log\n> ```\n\nSee `src/gone.ts:1`.\n",
  });
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "src/gone.ts:1");
});

Deno.test("doc-code-refs gate keeps a deeper marker inside a quoted example as content", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n> ```bash\n> $ grep `src/gone.ts:1` log\n>> ```\n> $ grep `src/gone.ts:1` again\n> ```\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate does not let an unclosed quoted block swallow later locators", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n> ```bash\n> $ grep `src/gone.ts:1` log\n\nSee `src/gone.ts:1`.\n",
  });
  assert(
    result.code === 1,
    `expected exit 1, got ${result.code}: ${result.stdout}`,
  );
  assertStringIncludes(result.stderr, "src/gone.ts:1");
});

Deno.test("doc-code-refs gate keeps prefix changes inside an unquoted block as literal code", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md":
      "# Doc\n\n```bash\n$ grep `src/gone.ts:1` log\n> ```ts\n$ grep `src/gone.ts:1` again\n```\n",
  });
  assert(
    result.code === 0,
    `expected exit 0, got ${result.code}: ${result.stderr}`,
  );
});

Deno.test("doc-code-refs gate scans deeper literal quote markers in a non-shell fence", async () => {
  const result = await runGate({
    "src/ok.ts": SOURCE,
    "doc.md": "# Doc\n\n> ```ts\n> > src/gone.ts:1\n> ```\n",
  });
  assert(result.code === 1, `expected exit 1, got ${result.code}: ${result.stdout}`);
  assertStringIncludes(result.stderr, "src/gone.ts:1");
});
