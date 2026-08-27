import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../source/provider-resource-reader.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedCodeExecutionRejectionDiagnostic,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  ISOLATED_OUTPUT_PUBLICATION_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeRuntimeAttestation,
  MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS,
  restoreIsolatedCodeExecutionReceipt,
  validateIsolatedCodeExecutionRejectionDiagnostic,
  validateIsolatedCodeExecutionRequest,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedCodeRuntimeAttestation,
} from "./isolated-code-execution.ts";

const encoder = new TextEncoder();
const A = "a".repeat(64);
const B = "b".repeat(64);

const RUNTIME: IsolatedCodeRuntimeAttestation = {
  isolationClass: "kernel-isolated",
  imageDigest: { algorithm: "sha256", digest: A },
  requestedLimits: {
    maxWallTimeMs: 1_000,
    maxCpuTimeMs: 500,
    maxMemoryBytes: 64_000_000,
    maxProcesses: 4,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    maxOutputFileBytes: 1_024,
    maxOutputTotalBytes: 2_048,
  },
  limitAssurance: {
    maxWallTimeMs: "backend-attested",
    maxCpuTimeMs: "unattested",
    maxMemoryBytes: "backend-attested",
    maxProcesses: "unattested",
    maxStdoutBytes: "broker-observed-cap",
    maxStderrBytes: "broker-observed-cap",
    maxOutputFileBytes: "broker-observed-cap",
    maxOutputTotalBytes: "broker-observed-cap",
  },
};

Deno.test("isolated execution request verifies source bytes and canonicalizes its exact manifest", async () => {
  const source = encoder.encode("result = make_part()\n");
  const request = await requestFixture(source, [{
    role: "mesh",
    basename: "result.msh",
    mediaType: "application/vnd.gmsh",
    format: "gmsh",
  }, {
    role: "geometry",
    basename: "result.step",
    mediaType: "model/step",
    format: "step-ap242",
  }]);

  const validated = await validateIsolatedCodeExecutionRequest(request);
  source.fill(0);

  assertEquals(validated.outputs.map((output) => output.role), [
    "geometry",
    "mesh",
  ]);
  assertEquals(
    new TextDecoder().decode(validated.source.bytes.copy()),
    "result = make_part()\n",
  );
});

Deno.test("isolated execution request rejects unknown fields, traversal, and basename collisions", async () => {
  const source = encoder.encode("source");
  const base = await requestFixture(source);

  await assertRejects(
    () =>
      validateIsolatedCodeExecutionRequest({
        ...base,
        provider: "docker",
      }),
    TypeError,
    "unsupported field provider",
  );
  await assertRejects(
    () =>
      validateIsolatedCodeExecutionRequest({
        ...base,
        outputs: [{
          ...base.outputs[0],
          basename: "../result.step",
        }],
      }),
    TypeError,
    "safe basename",
  );
  await assertRejects(
    () =>
      validateIsolatedCodeExecutionRequest({
        ...base,
        outputs: [base.outputs[0], {
          role: "geometry-copy",
          basename: "RESULT.STEP",
          mediaType: "model/step",
          format: "step-ap242",
        }],
      }),
    TypeError,
    "must not contain duplicates",
  );
});

Deno.test("isolated execution request never accepts a claimed source digest", async () => {
  const request = await requestFixture(encoder.encode("source"));

  await assertRejects(
    () =>
      validateIsolatedCodeExecutionRequest({
        ...request,
        source: { ...request.source, sha256: A },
      }),
    TypeError,
    "expected",
  );
});

Deno.test("isolated publication fingerprint has one strict pre-receipt object preimage", async () => {
  const output = encoder.encode("STEP-BYTES");
  const sha256 = await fingerprintResourceBytes(output);
  const tuple = {
    role: "geometry",
    basename: "result.step",
    mediaType: "model/step",
    format: "step-ap242",
    byteCount: output.byteLength,
    sha256,
    casUri: `casys://isolated-output/sha256/${sha256}`,
  };

  assertEquals(
    await fingerprintIsolatedOutputPublicationManifest(
      "run:compile-001",
      0,
      [tuple],
    ),
    await sha256Fingerprint({
      schemaVersion: ISOLATED_OUTPUT_PUBLICATION_SCHEMA,
      runId: "run:compile-001",
      producerGeneration: 0,
      outputs: [tuple],
    }),
  );
  await assertRejects(
    () =>
      fingerprintIsolatedOutputPublicationManifest("run:compile-001", 0, [{
        ...tuple,
        validation: "accepted",
        persistence: "staged-reread-atomic-commit",
      }]),
    TypeError,
    "unsupported field",
  );
});

Deno.test("isolated byte copy ignores subclass iterators and enforces intrinsic source length", async () => {
  class HostileBytes extends Uint8Array {
    override get byteLength(): number {
      return 1;
    }

    override *[Symbol.iterator](): ArrayIterator<number> {
      for (let index = 0; index < 1_000; index += 1) yield 255;
    }
  }
  const source = new HostileBytes(3);
  source.set([1, 2, 3]);
  const observed = new Uint8Array(source.buffer);
  const request = await requestFixture(observed);
  const validated = await validateIsolatedCodeExecutionRequest({
    ...request,
    source: { ...request.source, bytes: source },
  }, 3);

  assertEquals(validated.source.bytes.byteLength, 3);
  assertEquals(validated.source.bytes.copy(), new Uint8Array([1, 2, 3]));
  await assertRejects(
    () =>
      validateIsolatedCodeExecutionRequest({
        ...request,
        source: { ...request.source, bytes: source },
      }, 2),
    TypeError,
    "exceeds the configured byte cap",
  );
});

Deno.test("runtime contract separates requested ceilings from their assurance", () => {
  assertEquals(validateIsolatedCodeRuntimeAttestation(RUNTIME), RUNTIME);
  assertThrows(
    () =>
      validateIsolatedCodeRuntimeAttestation({
        ...RUNTIME,
        limitAssurance: {
          ...RUNTIME.limitAssurance,
          maxCpuTimeMs: "enforced",
        },
      }),
    TypeError,
    "supported assurance level",
  );
});

Deno.test("closed isolated execution receipts are deterministic and retain immutable observed bytes", async () => {
  const request = await validateIsolatedCodeExecutionRequest(
    await requestFixture(encoder.encode("source")),
  );
  const output = encoder.encode("STEP-BYTES");
  const outputSha256 = await fingerprintResourceBytes(output);
  const input = {
    request,
    runtime: RUNTIME,
    termination: { kind: "exited" as const, exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: encoder.encode("ok\n"), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: [{
      ...request.outputs[0],
      bytes: output,
      byteCount: output.byteLength,
      sha256: outputSha256,
      casUri: `casys://isolated-output/sha256/${outputSha256}`,
    }],
    destruction: {
      status: "proven" as const,
      runId: "run:compile-001",
      proofFingerprint: { algorithm: "sha256" as const, digest: B },
    },
    publication: await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      { algorithm: "sha256" as const, digest: A },
    ),
  };

  const first = await createIsolatedCodeExecutionReceipt(input);
  const repeated = await createIsolatedCodeExecutionReceipt(input);
  const record = isolatedCodeExecutionReceiptRecord(first);
  const restored = await restoreIsolatedCodeExecutionReceipt(record, [{
    role: first.outputs[0]!.role,
    bytes: output,
  }]);
  assertEquals("bytes" in record.outputs[0]!, false);
  assertEquals(restored.fingerprint, first.fingerprint);
  assertEquals(restored.outputs[0]!.bytes.copy(), output);
  output.fill(0);

  assertEquals(first.fingerprint, repeated.fingerprint);
  assertEquals(first.runtime.limitAssurance.maxCpuTimeMs, "unattested");
  assertEquals(first.destruction.status, "proven");
  assertEquals(Object.isFrozen(first), true);
  assertEquals(Object.isFrozen(first.logs), true);
  assertEquals(Object.isFrozen(first.fingerprint), true);
  assertEquals(first.outputs[0]?.bytes.copy(), encoder.encode("STEP-BYTES"));
  const copy = first.outputs[0]!.bytes.copy();
  copy.fill(0);
  assertEquals(first.outputs[0]?.bytes.copy(), encoder.encode("STEP-BYTES"));
});

Deno.test("closed receipt labels acknowledgement-only destruction without promoting it to proof", async () => {
  const request = await validateIsolatedCodeExecutionRequest(
    await requestFixture(encoder.encode("source")),
  );
  const output = encoder.encode("STEP-BYTES");
  const sha256 = await fingerprintResourceBytes(output);
  const publication = await createIsolatedOutputPublicationRef(
    request.runId,
    request.producerGeneration,
    { algorithm: "sha256", digest: A },
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: RUNTIME,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: [{
      ...request.outputs[0],
      bytes: output,
      byteCount: output.byteLength,
      sha256,
      casUri: `casys://isolated-output/sha256/${sha256}`,
    }],
    destruction: {
      status: "acknowledged-unattested",
      runId: "run:compile-001",
      acknowledgementFingerprint: { algorithm: "sha256", digest: B },
    },
    publication,
  });

  assertEquals(receipt.destruction.status, "acknowledged-unattested");
});

Deno.test("closed receipt accepts only the exact isolated-output CAS namespace", async () => {
  const request = await validateIsolatedCodeExecutionRequest(
    await requestFixture(encoder.encode("source")),
  );
  const output = encoder.encode("STEP-BYTES");
  const sha256 = await fingerprintResourceBytes(output);
  const publication = await createIsolatedOutputPublicationRef(
    request.runId,
    request.producerGeneration,
    { algorithm: "sha256", digest: A },
  );

  await assertRejects(
    () =>
      createIsolatedCodeExecutionReceipt({
        request,
        runtime: RUNTIME,
        termination: { kind: "exited", exitCode: 0, signal: null },
        logs: {
          stdout: { bytes: new Uint8Array(), truncated: false },
          stderr: { bytes: new Uint8Array(), truncated: false },
        },
        outputs: [{
          ...request.outputs[0],
          bytes: output,
          byteCount: output.byteLength,
          sha256,
          casUri: `casys://evil.example/arbitrary/sha256/${sha256}?tenant=x#fragment`,
        }],
        destruction: {
          status: "proven",
          runId: "run:compile-001",
          proofFingerprint: { algorithm: "sha256", digest: B },
        },
        publication,
      }),
    TypeError,
    "must equal",
  );
});

Deno.test("rejection diagnostic preserves log hashes and strips control sequences from excerpts", async () => {
  const stderr = encoder.encode("\x1b[31mMeshingError: empty NSET\x1b[0m\n");
  const diagnostic = await createIsolatedCodeExecutionRejectionDiagnostic({
    termination: { kind: "exited", exitCode: 1, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: stderr, truncated: false },
    },
    maximumLogBytes: { stdout: 1_024, stderr: 1_024 },
  });
  assertEquals(diagnostic.termination.exitCode, 1);
  assertEquals(
    diagnostic.logs.stderr.sha256,
    await fingerprintResourceBytes(stderr),
  );
  assertEquals(diagnostic.logs.stderr.byteCount, stderr.byteLength);
  assertEquals(diagnostic.logs.stderr.truncated, false);
  assertEquals(diagnostic.logs.stderr.excerpt, "MeshingError: empty NSET\n");
  assertEquals(diagnostic.logs.stdout.excerpt, "");
  const reread = validateIsolatedCodeExecutionRejectionDiagnostic(diagnostic);
  assertEquals(reread, diagnostic);
  await assertRejects(
    () =>
      createIsolatedCodeExecutionRejectionDiagnostic({
        termination: { kind: "exited", exitCode: 0, signal: null },
        logs: {
          stdout: { bytes: new Uint8Array(), truncated: false },
          stderr: { bytes: new Uint8Array(), truncated: false },
        },
        maximumLogBytes: { stdout: 1_024, stderr: 1_024 },
      }),
    TypeError,
    "unsuccessful isolated execution",
  );
});

Deno.test("output-validation rejection retains only role, byteCount and sha256", () => {
  const observation = validateIsolatedCodeOutputValidationRejection({
    role: "geometry",
    byteCount: 4,
    sha256: A,
  });
  assertEquals(observation, { role: "geometry", byteCount: 4, sha256: A });
  assertThrows(
    () =>
      validateIsolatedCodeOutputValidationRejection({
        role: "geometry",
        byteCount: 4,
        sha256: A,
        bytes: new Uint8Array([1, 2, 3, 4]),
        path: "/tmp/sandbox/result.step",
        message: "invalid STEP payload",
      }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("rejection diagnostic caps excerpts independently of captured log bytes", async () => {
  const body = "x".repeat(
    MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS + 64,
  );
  const diagnostic = await createIsolatedCodeExecutionRejectionDiagnostic({
    termination: { kind: "timed-out", exitCode: null, signal: null },
    logs: {
      stdout: { bytes: encoder.encode(body), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    maximumLogBytes: { stdout: 8_192, stderr: 8_192 },
  });
  assertEquals(
    diagnostic.logs.stdout.excerpt.length,
    MAXIMUM_ISOLATED_EXECUTION_REJECTION_EXCERPT_CODE_UNITS,
  );
  assertEquals(
    diagnostic.logs.stdout.byteCount,
    encoder.encode(body).byteLength,
  );
  assertThrows(
    () =>
      validateIsolatedCodeExecutionRejectionDiagnostic({
        ...diagnostic,
        logs: {
          ...diagnostic.logs,
          stdout: {
            ...diagnostic.logs.stdout,
            excerpt: "\x1b[31mred\x1b[0m",
          },
        },
      }),
    TypeError,
    "terminal control sequences",
  );
});

async function requestFixture(
  source: Uint8Array,
  outputs = [{
    role: "geometry",
    basename: "result.step",
    mediaType: "model/step",
    format: "step-ap242",
  }],
): Promise<IsolatedCodeExecutionRequest> {
  return {
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: "run:compile-001",
    producerGeneration: 0,
    profile: { id: "build123d-source", version: "1.0" },
    source: {
      bytes: source,
      sha256: await fingerprintResourceBytes(source),
    },
    policy: {
      id: "kernel-isolated-no-network",
      version: "1.0",
      fingerprint: { algorithm: "sha256", digest: B },
    },
    outputs,
  };
}
