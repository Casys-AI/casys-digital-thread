import { assertEquals, assertRejects } from "@std/assert";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { createModelicaMicrosandboxQualificationCapture } from "../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  createModelicaMicrosandboxQualificationKit,
  MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
  MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
  MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
} from "./kit-v1/qualification-kit.ts";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "./execution-profile.ts";
import {
  FileModelicaMicrosandboxQualificationStore,
  ModelicaMicrosandboxQualificationIntegrityError,
  PublicationBackedModelicaMicrosandboxQualificationAuthority,
} from "./microsandbox-qualification.ts";

const DIGEST = "a".repeat(64);
const ENCODER = new TextEncoder();

Deno.test("qualification authority reopens the exact receipt and externally revalidates CSV bytes", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-microsandbox-qualification-",
  });
  try {
    const fixture = await createFixture();
    const store = new FileModelicaMicrosandboxQualificationStore(
      `${directory}/captures`,
    );
    const reference = await store.save(fixture.capture);
    let receiptReads = 0;
    let outputReads = 0;
    const authority = new PublicationBackedModelicaMicrosandboxQualificationAuthority({
      store: new FileModelicaMicrosandboxQualificationStore(
        `${directory}/captures`,
      ),
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("unreachable")),
        readReceipt: () => {
          receiptReads += 1;
          return Promise.resolve(fixture.receipt);
        },
        readPublishedObject: (_ref, member) => {
          outputReads += 1;
          return Promise.resolve(fixture.outputs.get(member.role)?.slice());
        },
      },
      pinnedCaptureFingerprint: reference.fingerprint,
    });
    assertEquals(await authority.reopenQualified(fixture.profile), reference);
    assertEquals(receiptReads, 1);
    assertEquals(outputReads, 2);

    const tampered = new PublicationBackedModelicaMicrosandboxQualificationAuthority({
      store,
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("unreachable")),
        readReceipt: () => Promise.resolve(fixture.receipt),
        readPublishedObject: (_ref, member) =>
          Promise.resolve(
            member.role === "result"
              ? ENCODER.encode("time,temperatureC\n0,20\n2,99\n")
              : fixture.outputs.get(member.role)?.slice(),
          ),
      },
      pinnedCaptureFingerprint: reference.fingerprint,
    });
    await assertRejects(
      () => tampered.reopenQualified(fixture.profile),
      TypeError,
      "qualified intervals",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualification capture rejects arbitrary authority hashes and foreign profile activation", async () => {
  const fixture = await createFixture();
  await assertRejects(
    () =>
      createModelicaMicrosandboxQualificationCapture({
        ...fixture.capture,
        bundle: {
          ...fixture.capture.bundle,
          document: {
            ...fixture.capture.bundle.document,
            qualification: {
              ...fixture.capture.bundle.document.qualification,
              caseSha256: "f".repeat(64),
            },
          },
        },
      }),
    TypeError,
    "bundle",
  );

  const directory = await Deno.makeTempDir({ prefix: "casys-modelica-profile-pin-" });
  try {
    const store = new FileModelicaMicrosandboxQualificationStore(directory);
    const reference = await store.save(fixture.capture);
    const foreignProfile = await profileFixture("b".repeat(64));
    const authority = new PublicationBackedModelicaMicrosandboxQualificationAuthority({
      store,
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("unreachable")),
        readReceipt: () => Promise.resolve(fixture.receipt),
        readPublishedObject: (_ref, member) =>
          Promise.resolve(fixture.outputs.get(member.role)?.slice()),
      },
      pinnedCaptureFingerprint: reference.fingerprint,
    });
    await assertRejects(
      () => authority.reopenQualified(foreignProfile),
      ModelicaMicrosandboxQualificationIntegrityError,
      "another local profile",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function createFixture() {
  const profile = await profileFixture(DIGEST);
  const kit = await createModelicaMicrosandboxQualificationKit(
    profile.method.engine,
  );
  const rows = Array.from(
    { length: 21 },
    (_, index) => `${index / 10},${20 + index / 10}`,
  );
  const resultBytes = ENCODER.encode(
    `time,temperatureC\n${rows.join("\n")}\n`,
  );
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/1.0" as const,
    inputBundleSha256: kit.bundle.fingerprint.digest,
    status: "succeeded" as const,
    method: kit.bundle.document.method,
    resolvedParameters: kit.bundle.document.invocation.parameters.map((parameter) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      value: parameter.inputValue,
      unit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    metrics: [{ id: "temperature_final", value: 22, unit: "degC" }],
    result: {
      role: "result" as const,
      basename: "result.csv" as const,
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [] as const,
  };
  const evidenceBytes = ENCODER.encode(deterministicJson(evidence));
  const outputs = new Map([
    ["evidence", evidenceBytes],
    ["result", resultBytes],
  ]);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: "isolated-code-execution-request/1.0",
    runId: "modelica-qualification-run-1",
    producerGeneration: 0,
    profile: profile.executionProfile,
    source: {
      bytes: kit.bundle.bytes,
      sha256: kit.bundle.fingerprint.digest,
    },
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
  });
  const outputMembers = await Promise.all(profile.outputManifest.map(
    async (declaration) => {
      const bytes = outputs.get(declaration.role)!;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
        bytes,
      };
    },
  ));
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    request.runId,
    request.producerGeneration,
    outputMembers.map(({ bytes: _bytes, ...member }) => member),
  );
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: outputMembers,
    destruction: {
      status: "proven",
      runId: request.runId,
      proofFingerprint: { algorithm: "sha256", digest: "8".repeat(64) },
    },
    publication: await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      publicationFingerprint,
    ),
  });
  const capture = await createModelicaMicrosandboxQualificationCapture({
    schemaVersion: "modelica-microsandbox-qualification-capture/1.0",
    status: "qualified-live-smoke",
    qualifiedAt: "2026-08-14T00:00:00.000Z",
    executionProfileFingerprint: profile.profileFingerprint,
    image: {
      reference: profile.runtimeBackend.imageReference,
      digest: profile.runtime.imageDigest,
    },
    worker: {
      wrapperSha256: MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
      workerContractSha256: MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
      denoLockSha256: MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
    },
    basis: kit.basis,
    bundle: {
      document: kit.bundle.document,
      fingerprint: kit.bundle.fingerprint,
      byteCount: kit.bundle.bytes.byteLength,
    },
    executionRunId: request.runId,
    receipt: isolatedCodeExecutionReceiptRecord(receipt),
    evidence,
  });
  return { profile, capture, receipt, outputs };
}

function profileFixture(digest: string) {
  return new FixedModelicaIsolatedExecutionProfileCatalog({
    imageReference: `casys/modelica-microsandbox-worker@sha256:${digest}`,
    policy: {
      id: "modelica-local-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 120_000,
      maxMemoryBytes: 3 * 1_073_741_824,
      maxProcesses: 64,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      maxOutputFileBytes: 16 * 1_048_576,
      maxOutputTotalBytes: 17 * 1_048_576,
    },
    engine: { name: "OpenModelica", version: "1.27.0", mslVersion: "4.1.0" },
  }).initial();
}
