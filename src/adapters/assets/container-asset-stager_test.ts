/**
 * Tests for the container-side asset staging boundary.
 *
 * Test coverage:
 *
 *   Guards (TypeError — programmer errors, not staging errors):
 *   - DockerVolumeAssetStager rejects a service name with unsafe characters at
 *     construction time.
 *   - stage() rejects a containerFileName containing forbidden characters.
 *   - stage() rejects an expectedDigest that is not 64 lowercase hex chars.
 *
 *   Pre-verification (pre_verify_failed — no Docker command is run):
 *   - stage() fails pre_verify when the host file is not found.
 *   - stage() fails pre_verify when the host file has wrong byte count.
 *   - stage() fails pre_verify when the host file has the right size but wrong
 *     SHA-256 (tampered content).
 *
 *   Idempotency:
 *   - stage() returns immediately when the container file already exists with
 *     the expected digest (one exec call, no cp call).
 *
 *   Error codes (Docker failures, post-copy):
 *   - stage() surfaces copy_failed when `docker compose cp` exits non-zero.
 *   - stage() surfaces post_read_failed when the container re-read fails.
 *   - stage() surfaces sha256_mismatch when the re-read digest differs from
 *     the expected digest.
 *
 *   Happy path:
 *   - stage() completes without error when all steps succeed and the container
 *     digest matches the expected digest.
 *
 * All tests inject a fake command runner and a fake host-file reader so no
 * real Docker daemon or filesystem access is required. The fake runner returns
 * responses in call order, making each test scenario fully deterministic.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  ContainerAssetStagingError,
  type ContainerCommandRunner,
  DockerVolumeAssetStager,
  type HostFileReader,
} from "./container-asset-stager.ts";

// ── Test-only helpers ────────────────────────────────────────────────────────

/** Compute SHA-256 in the same way the module does, for test assertions. */
async function sha256HexTest(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type FakeResult = {
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
  code: number;
};

/**
 * Build a fake command runner that dispenses responses in call order.
 * Throws if more calls are made than responses provided.
 */
function makeQueueRunner(responses: FakeResult[]): {
  runner: ContainerCommandRunner;
  calls: Array<{ exe: string; args: string[] }>;
} {
  const calls: Array<{ exe: string; args: string[] }> = [];
  let i = 0;
  const runner: ContainerCommandRunner = (exe, args) => {
    calls.push({ exe, args });
    const response = responses[i];
    if (response === undefined) {
      throw new Error(
        `Fake runner exhausted at index ${i}: ${exe} ${args.join(" ")}`,
      );
    }
    i++;
    return Promise.resolve(response);
  };
  return { runner, calls };
}

function okResult(stdout: Uint8Array = new Uint8Array()): FakeResult {
  return { success: true, stdout, stderr: new Uint8Array(), code: 0 };
}

function failResult(stderr = "docker error"): FakeResult {
  return {
    success: false,
    stdout: new Uint8Array(),
    stderr: new TextEncoder().encode(stderr),
    code: 1,
  };
}

function readerFor(bytes: Uint8Array): HostFileReader {
  return (_path) => Promise.resolve(bytes);
}

function readerMissing(): HostFileReader {
  return (_path) => Promise.resolve(undefined);
}

/** Standard test fixture — small byte array representing a fake STEP file. */
const FIXTURE = new TextEncoder().encode("ISO-10303-21;");

// ── Constructor guard ────────────────────────────────────────────────────────

Deno.test(
  "DockerVolumeAssetStager rejects a service name with unsafe characters at construction",
  () => {
    assertThrows(
      () =>
        new DockerVolumeAssetStager({
          service: "my service!",
          containerDirectory: "/exports",
        }),
      TypeError,
      "is not safe",
    );
  },
);

Deno.test(
  "DockerVolumeAssetStager rejects a non-absolute or traversable target directory",
  () => {
    for (const containerDirectory of ["inputs", "/", "/inputs/../exports"]) {
      assertThrows(
        () =>
          new DockerVolumeAssetStager({
            service: "calculix",
            containerDirectory,
          }),
        TypeError,
        "safe absolute path",
      );
    }
  },
);

// ── stage() input guards (TypeError) ────────────────────────────────────────

Deno.test(
  "stage() rejects a containerFileName containing a forward slash",
  async () => {
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: makeQueueRunner([]).runner,
      hostFileReader: readerMissing(),
    });
    await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/tmp/file.step",
          expectedDigest: "a".repeat(64),
          expectedBytes: 1,
          containerFileName: "sub/file.step",
        }),
      TypeError,
      "is not safe",
    );
  },
);

Deno.test(
  "stage() rejects an expectedDigest that contains uppercase hex characters",
  async () => {
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: makeQueueRunner([]).runner,
      hostFileReader: readerMissing(),
    });
    await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/tmp/file.step",
          expectedDigest: "A".repeat(64),
          expectedBytes: 1,
          containerFileName: "file.step",
        }),
      TypeError,
      "64-character lowercase hex",
    );
  },
);

Deno.test(
  "stage() rejects an expectedDigest that is shorter than 64 characters",
  async () => {
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: makeQueueRunner([]).runner,
      hostFileReader: readerMissing(),
    });
    await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/tmp/file.step",
          expectedDigest: "abc",
          expectedBytes: 1,
          containerFileName: "file.step",
        }),
      TypeError,
      "64-character lowercase hex",
    );
  },
);

// ── Pre-verification failures (no Docker command is run) ─────────────────────

Deno.test(
  "stage() surfaces pre_verify_failed when the host file is not found",
  async () => {
    const { runner, calls } = makeQueueRunner([]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerMissing(),
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/missing.step",
          expectedDigest: "a".repeat(64),
          expectedBytes: 4,
          containerFileName: "missing.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "pre_verify_failed");
    assertEquals(err.context.sourcePath, "/host/missing.step");
    assertEquals(calls.length, 0); // no Docker command was attempted
  },
);

Deno.test(
  "stage() surfaces pre_verify_failed when the host file has wrong byte count",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner, calls } = makeQueueRunner([]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/file.step",
          expectedDigest: fixtureDigest,
          expectedBytes: FIXTURE.length + 100, // wrong size
          containerFileName: "file.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "pre_verify_failed");
    assertEquals(err.context.expectedBytes, String(FIXTURE.length + 100));
    assertEquals(err.context.actualBytes, String(FIXTURE.length));
    assertEquals(calls.length, 0);
  },
);

Deno.test(
  "stage() surfaces pre_verify_failed when the host file has right size but wrong SHA-256",
  async () => {
    const wrongContent = new Uint8Array(FIXTURE.length).fill(0xff);
    const correctDigest = await sha256HexTest(FIXTURE); // digest of expected, not of what we read
    const { runner, calls } = makeQueueRunner([]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(wrongContent), // tampered bytes, same length
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/file.step",
          expectedDigest: correctDigest,
          expectedBytes: FIXTURE.length,
          containerFileName: "file.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "pre_verify_failed");
    assertEquals(err.context.expected, correctDigest);
    assertEquals(calls.length, 0);
  },
);

// ── Idempotency ──────────────────────────────────────────────────────────────

Deno.test(
  "stage() returns immediately when the container file already has the expected digest",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    // Idempotency exec returns the fixture bytes → digest matches → no cp.
    const { runner, calls } = makeQueueRunner([okResult(FIXTURE)]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const planned = stager.resolveTarget({ containerFileName: "file.step" });
    const staged = await stager.stage({
      sourcePath: "/host/file.step",
      expectedDigest: fixtureDigest,
      expectedBytes: FIXTURE.length,
      containerFileName: "file.step",
    });
    assertEquals(staged, planned);
    assertEquals(Object.isFrozen(staged), true);
    assertEquals(calls.length, 1); // only the idempotency exec, no cp, no post-read
    // Confirm it was an exec call, not a cp call.
    assertEquals(calls[0].args.includes("exec"), true);
    assertEquals(calls[0].args.includes("cp"), false);
  },
);

// ── copy_failed ───────────────────────────────────────────────────────────────

Deno.test(
  "stage() surfaces copy_failed when docker compose cp exits non-zero",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner, calls } = makeQueueRunner([
      failResult(), // idempotency exec → file absent in container
      failResult("cp: permission denied"), // cp → failure
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/file.step",
          expectedDigest: fixtureDigest,
          expectedBytes: FIXTURE.length,
          containerFileName: "file.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "copy_failed");
    assertEquals(err.context.service, "calculix");
    assertEquals(err.context.containerFileName, "file.step");
    assertEquals(calls.length, 2);
  },
);

// ── post_read_failed ──────────────────────────────────────────────────────────

Deno.test(
  "stage() surfaces post_read_failed when the container re-read fails after copy",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner } = makeQueueRunner([
      failResult(), // idempotency exec → absent
      okResult(), // cp → success
      failResult("cat: no such file"), // post-read exec → failure
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/file.step",
          expectedDigest: fixtureDigest,
          expectedBytes: FIXTURE.length,
          containerFileName: "file.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "post_read_failed");
    assertEquals(err.context.containerFileName, "file.step");
    assertEquals(err.context.containerPath, "/exports/file.step");
  },
);

// ── sha256_mismatch ───────────────────────────────────────────────────────────

Deno.test(
  "stage() surfaces sha256_mismatch when the container digest differs from the expected digest",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const corruptBytes = new Uint8Array(FIXTURE.length).fill(0xde);
    const { runner } = makeQueueRunner([
      failResult(), // idempotency exec → absent
      okResult(), // cp → success
      okResult(corruptBytes), // post-read → different bytes
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const err = await assertRejects(
      () =>
        stager.stage({
          sourcePath: "/host/file.step",
          expectedDigest: fixtureDigest,
          expectedBytes: FIXTURE.length,
          containerFileName: "file.step",
        }),
      ContainerAssetStagingError,
    );
    assertEquals(err.code, "sha256_mismatch");
    assertEquals(err.context.expected, fixtureDigest);
    assertEquals(err.context.containerFileName, "file.step");
  },
);

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test(
  "stage() completes without error when host file, copy, and post-read all succeed",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner, calls } = makeQueueRunner([
      failResult(), // idempotency exec → absent
      okResult(), // cp → success
      okResult(FIXTURE), // post-read → right bytes
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    const planned = stager.resolveTarget({ containerFileName: "file.step" });
    const staged = await stager.stage({
      sourcePath: "/host/file.step",
      expectedDigest: fixtureDigest,
      expectedBytes: FIXTURE.length,
      containerFileName: "file.step",
    });
    assertEquals(staged, planned);
    assertEquals(Object.isFrozen(staged), true);
    assertEquals(calls.length, 3);
    // Verify command sequence: exec (idempotency), cp, exec (post-read).
    assertEquals(calls[0].args.includes("exec"), true);
    assertEquals(calls[1].args.includes("cp"), true);
    assertEquals(calls[2].args.includes("exec"), true);
  },
);

Deno.test(
  "stage() respects composeProjectDirectory in all Docker commands",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner, calls } = makeQueueRunner([
      failResult(), // idempotency → absent
      okResult(), // cp
      okResult(FIXTURE), // post-read
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports",
      composeProjectDirectory: "/opt/project",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    await stager.stage({
      sourcePath: "/host/file.step",
      expectedDigest: fixtureDigest,
      expectedBytes: FIXTURE.length,
      containerFileName: "file.step",
    });
    for (const call of calls) {
      const projDirIdx = call.args.indexOf("--project-directory");
      assertEquals(projDirIdx !== -1, true);
      assertEquals(call.args[projDirIdx + 1], "/opt/project");
    }
  },
);

Deno.test(
  "stage() assembles the container path from containerDirectory and containerFileName",
  async () => {
    const fixtureDigest = await sha256HexTest(FIXTURE);
    const { runner, calls } = makeQueueRunner([
      failResult(),
      okResult(),
      okResult(FIXTURE),
    ]);
    const stager = new DockerVolumeAssetStager({
      service: "calculix",
      containerDirectory: "/exports/fea",
      commandRunner: runner,
      hostFileReader: readerFor(FIXTURE),
    });
    await stager.stage({
      sourcePath: "/host/piece.step",
      expectedDigest: fixtureDigest,
      expectedBytes: FIXTURE.length,
      containerFileName: "piece.step",
    });
    // The cp destination must be service:containerDirectory/containerFileName.
    const cpArgs = calls[1].args;
    const destIdx = cpArgs.indexOf("/host/piece.step") + 1;
    assertEquals(cpArgs[destIdx], "calculix:/exports/fea/piece.step");
  },
);
