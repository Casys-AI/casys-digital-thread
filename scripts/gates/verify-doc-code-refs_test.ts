/**
 * Fixture tests for the doc-code-refs gate. Each case builds a minimal git
 * repository in a temp dir, copies the gate next to it, and runs it as a
 * subprocess in strict mode: resolving refs pass, while missing targets,
 * absolute locators, and over-long fences behave as documented.
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

async function runGate(files: Record<string, string>): Promise<GateResult> {
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
        "--mode=strict",
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
