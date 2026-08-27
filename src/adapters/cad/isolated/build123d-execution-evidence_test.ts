import { assertEquals, assertRejects } from "@std/assert";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  type Build123dExecutionAdmission,
  validateBuild123dExecutionAdmission,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  buildBuild123dExecutionDraftReference,
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  FileBuild123dExecutionCaptureStore,
  FileBuild123dExecutionDraftStore,
} from "./build123d-execution-evidence.ts";

const PROJECT_ID = "project.box";
const AGENT_RUN_ID = "agent-run.build123d.1";
const PRODUCER_GENERATION = 0 as const;

Deno.test("Build123d evidence stores atomically save and exactly reread private CAS records", async () => {
  await usingDirectory(async (directory) => {
    const fixture = await fixtureValue();
    const draftStore = new FileBuild123dExecutionDraftStore(`${directory}/drafts`);
    const captureStore = new FileBuild123dExecutionCaptureStore(
      `${directory}/captures`,
    );

    const persistedDraft = await draftStore.save(fixture.draft);
    const repeatedDraft = await draftStore.save(fixture.draft);
    assertEquals(repeatedDraft, persistedDraft);
    assertEquals(
      await draftStore.read(persistedDraft.reference),
      fixture.draft,
    );
    assertEquals(fixture.draft.producerGeneration, PRODUCER_GENERATION);
    assertEquals(
      fixture.draft.receiptRecord.producerGeneration,
      PRODUCER_GENERATION,
    );
    assertEquals(
      fixture.draft.publicationRef.producerGeneration,
      PRODUCER_GENERATION,
    );

    const capture = await createBuild123dExecutionCapture({
      ...fixture.input,
      draftReference: persistedDraft.reference,
    });
    const persistedCapture = await captureStore.save(capture);
    assertEquals(
      await captureStore.read(persistedCapture.fingerprint),
      capture,
    );
    assertEquals(
      persistedCapture.uri,
      `casys://build123d-execution-capture/sha256/${persistedCapture.fingerprint.digest}`,
    );
    assertEquals(
      recursiveKeys(persistedDraft).has("uri"),
      false,
      "draft storage URI must stay private",
    );

    if (Deno.build.os !== "windows") {
      assertEquals((await Deno.stat(`${directory}/drafts`)).mode! & 0o777, 0o700);
      assertEquals((await Deno.stat(`${directory}/captures`)).mode! & 0o777, 0o700);
      assertEquals(
        (await Deno.stat(
          `${directory}/drafts/${persistedDraft.reference.fingerprint.digest}.json`,
        )).mode! & 0o777,
        0o600,
      );
      assertEquals(
        (await Deno.stat(
          `${directory}/captures/${persistedCapture.fingerprint.digest}.json`,
        )).mode! & 0o777,
        0o600,
      );
    }
  });
});

Deno.test("Build123d draft store fails closed on non-canonical and corrupted content", async () => {
  await usingDirectory(async (directory) => {
    const fixture = await fixtureValue();
    const store = new FileBuild123dExecutionDraftStore(`${directory}/drafts`);
    const persisted = await store.save(fixture.draft);
    const path = `${directory}/drafts/${persisted.reference.fingerprint.digest}.json`;

    await Deno.writeTextFile(path, `${deterministicJson(fixture.draft)}\n`);
    await assertRejects(
      () => store.read(persisted.reference),
      Error,
    );
    await Deno.writeTextFile(path, "not-json");
    await assertRejects(
      () => store.read(persisted.reference),
      Error,
    );
  });
});

Deno.test("Build123d capture store detects file corruption and never accepts another digest", async () => {
  await usingDirectory(async (directory) => {
    const fixture = await fixtureValue();
    const draftReference = await buildBuild123dExecutionDraftReference(
      fixture.draft,
    );
    const capture = await createBuild123dExecutionCapture({
      ...fixture.input,
      draftReference,
    });
    const store = new FileBuild123dExecutionCaptureStore(`${directory}/captures`);
    const persisted = await store.save(capture);
    const path = `${directory}/captures/${persisted.fingerprint.digest}.json`;
    await Deno.writeTextFile(path, "{}");
    await assertRejects(() => store.read(persisted.fingerprint), Error);
    assertEquals(await store.read(hash("9")), undefined);
  });
});

async function fixtureValue() {
  const source = new TextEncoder().encode(
    "from build123d import Box\nresult = Box(20, 10, 2)\n",
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const imageReference = `ghcr.io/casys-ai/build123d-runtime@sha256:${"c".repeat(64)}`;
  const runtime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits: limits(),
  });
  const admission: Build123dExecutionAdmission = validateBuild123dExecutionAdmission({
    schemaVersion: "build123d-execution-admission/2.0",
    admissionArtifact: {
      schemaVersion: "technical-compilation-admission-capture/4.0",
      id: `technical-compilation-admission-${"1".repeat(64)}`,
      fingerprint: hash("1"),
    },
    compilation: {
      document: {
        schemaVersion: "technical-compilation/2.0",
        fingerprint: hash("2"),
        status: "ready-for-review",
      },
      projection: {
        target: "build123d-source",
        fingerprint: hash("3"),
        status: "ready-for-review",
      },
      source: {
        id: "source.box",
        sourceFingerprint: { algorithm: "sha256", digest: sourceSha256 },
        captureFingerprint: hash("4"),
        analysisFingerprint: hash("5"),
      },
      profile: {
        id: "build123d-closed-subset-v1",
        version: "1.0.0",
        fingerprint: hash("6"),
      },
    },
    execution: {
      profile: { ...BUILD123D_EXECUTION_PROFILE, fingerprint: hash("a") },
      isolationPolicy: {
        id: "isolation.build123d-closed-v1",
        version: "1.0.0",
        fingerprint: hash("b"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference,
        imageDigest: runtime.imageDigest,
      },
      runtime: {
        imageDigest: runtime.imageDigest,
        isolationClass: runtime.isolationClass,
        limits: runtime.requestedLimits,
        limitAssurance: runtime.limitAssurance,
      },
      outputValidator: { id: "occt-step-ap214", version: "1.0.0" },
      output: BUILD123D_EXECUTION_OUTPUT,
      minimumDestructionAssurance: "proven",
    },
    status: "ready-for-execution-review",
  });
  const executionRunId = await deriveBuild123dExecutionRunId(
    PROJECT_ID,
    AGENT_RUN_ID,
  );
  const step = new TextEncoder().encode("STEP");
  const stepSha256 = await fingerprintResourceBytes(step);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: executionRunId,
    producerGeneration: PRODUCER_GENERATION,
    profile: BUILD123D_EXECUTION_PROFILE,
    source: { bytes: source, sha256: sourceSha256 },
    policy: admission.execution.isolationPolicy,
    outputs: [BUILD123D_EXECUTION_OUTPUT],
  });
  const publicationMember = {
    ...BUILD123D_EXECUTION_OUTPUT,
    byteCount: step.byteLength,
    sha256: stepSha256,
    casUri: `casys://isolated-output/sha256/${stepSha256}`,
  };
  const outputRecord = {
    ...publicationMember,
    validation: "accepted" as const,
    persistence: "staged-reread-atomic-commit" as const,
  };
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    executionRunId,
    PRODUCER_GENERATION,
    [publicationMember],
  );
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: admission.execution.runtime.isolationClass,
        imageDigest: admission.execution.runtime.imageDigest,
        requestedLimits: admission.execution.runtime.limits,
        limitAssurance: admission.execution.runtime.limitAssurance,
      },
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: [{ ...outputRecord, bytes: step }],
      destruction: {
        status: "proven",
        runId: executionRunId,
        proofFingerprint: hash("d"),
      },
      publication: await createIsolatedOutputPublicationRef(
        executionRunId,
        PRODUCER_GENERATION,
        publicationFingerprint,
      ),
    }),
  );
  const input = {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.box",
      fingerprint: hash("e"),
    },
    agentRunId: AGENT_RUN_ID,
    executionRunId,
    decisionId: "decision.execute.build123d.1",
    executedAt: "2026-08-13T12:34:56.000Z",
    admission,
    receiptRecord: receipt,
  };
  return { input, draft: await createBuild123dExecutionDraft(input) };
}

async function usingDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "build123d-evidence-" });
  try {
    await run(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

function limits() {
  return {
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 33_554_432,
    maxOutputTotalBytes: 33_554_432,
  };
}

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

function recursiveKeys(value: unknown, seen = new Set<unknown>()): Set<string> {
  const keys = new Set<string>();
  if (value === null || typeof value !== "object" || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    for (const nested of recursiveKeys(child, seen)) keys.add(nested);
  }
  return keys;
}
