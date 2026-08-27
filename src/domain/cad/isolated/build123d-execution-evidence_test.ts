import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  type Build123dExecutionAdmission,
  validateBuild123dExecutionAdmission,
} from "./build123d-execution-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../compile/isolation/local-isolation-runtime.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeRuntimeAttestation,
  type IsolatedOutputProducerGeneration,
  validateIsolatedCodeExecutionRequest,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  type Build123dExecutionBasis,
  buildBuild123dExecutionDraftReference,
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
  validateBuild123dExecutionCapture,
  validateBuild123dExecutionDraft,
  validateBuild123dExecutionDraftReference,
} from "./build123d-execution-evidence.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";

const PROJECT_ID = "project.box";
const AGENT_RUN_ID = "agent-run.build123d.1";
const EXECUTED_AT = "2026-08-13T12:34:56.000Z";
const PRODUCER_GENERATION = 0 as const;
const SOURCE = new TextEncoder().encode(
  "from build123d import Box\nresult = Box(20, 10, 2)\n",
);
const STEP = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n");

Deno.test("Build123d execution evidence closes one noncanonical draft and one documentary capture", async () => {
  const fixture = await evidenceFixture();
  const draft = await createBuild123dExecutionDraft(fixture.input);
  const reference = await buildBuild123dExecutionDraftReference(draft);
  const capture = await createBuild123dExecutionCapture({
    ...fixture.input,
    draftReference: reference,
  });

  assertEquals(capture.noncanonicalDraft, reference);
  assertEquals(draft.stepOutput, fixture.receipt.outputs[0]);
  assertEquals(draft.status, "noncanonical-awaiting-geometry-review");
  assertEquals(capture.receiptRecord.publication.ref, draft.publicationRef);
  assertEquals(draft.producerGeneration, PRODUCER_GENERATION);
  assertEquals(draft.receiptRecord.producerGeneration, PRODUCER_GENERATION);
  assertEquals(draft.publicationRef.producerGeneration, PRODUCER_GENERATION);
  assertEquals(capture.producerGeneration, PRODUCER_GENERATION);
  assertEquals(capture.executedAt, EXECUTED_AT);
  assertEquals(Object.isFrozen(capture), true);
  assertEquals(Object.isFrozen(capture.receiptRecord), true);
  assertEquals(Object.isFrozen(draft), true);

  const keys = recursiveKeys({ capture, draft });
  for (
    const forbidden of [
      "bytes",
      "sourceText",
      "path",
      "provider",
      "handle",
      "command",
      "arguments",
    ]
  ) {
    assertEquals(keys.has(forbidden), false, `forbidden key ${forbidden}`);
  }
  assertEquals(deterministicJson(draft).includes("from build123d"), false);
  assertEquals(deterministicJson(capture).includes("ISO-10303"), false);
});

Deno.test("Build123d evidence roundtrips generation one and rejects generation drift", async () => {
  const fixture = await evidenceFixture();
  const draft = await createBuild123dExecutionDraft(fixture.input);
  const generationOneReceipt = await receiptFor(
    fixture.admission,
    fixture.executionRunId,
    { producerGeneration: 1 },
  );
  const generationOneDraft = await createBuild123dExecutionDraft({
    ...fixture.input,
    receiptRecord: generationOneReceipt,
  });
  const generationOneReference = await buildBuild123dExecutionDraftReference(
    generationOneDraft,
  );
  const generationOneCapture = await createBuild123dExecutionCapture({
    ...fixture.input,
    receiptRecord: generationOneReceipt,
    draftReference: generationOneReference,
  });
  assertEquals(
    (await validateBuild123dExecutionDraft(generationOneDraft)).producerGeneration,
    1,
  );
  assertEquals(
    (await validateBuild123dExecutionCapture(generationOneCapture))
      .producerGeneration,
    1,
  );

  await assertRejects(
    () =>
      validateBuild123dExecutionDraft({
        ...draft,
        receiptRecord: generationOneReceipt,
      }),
    TypeError,
    "receiptRecord does not match the exact admission",
  );
  await assertRejects(
    () =>
      validateBuild123dExecutionDraft({
        ...draft,
        publicationRef: generationOneReceipt.publication.ref,
      }),
    TypeError,
    "producerGeneration does not match the execution dispatch",
  );
  await assertRejects(
    () =>
      validateBuild123dExecutionDraft({
        ...draft,
        producerGeneration: 1,
      }),
    TypeError,
    "producerGeneration does not match the execution dispatch",
  );
});

Deno.test("Build123d evidence recomputes run, profile, policy, runtime, source, output, destruction and publication identity", async () => {
  const fixture = await evidenceFixture();
  const alternateRuntime = {
    ...runtimeOf(fixture.admission),
    imageDigest: hash("9"),
  };
  const mismatchReceipts = [
    await receiptFor(fixture.admission, fixture.executionRunId, {
      profile: { ...BUILD123D_EXECUTION_PROFILE, version: "1.0.1" },
    }),
    await receiptFor(fixture.admission, fixture.executionRunId, {
      policy: {
        ...fixture.admission.execution.isolationPolicy,
        version: "1.0.1",
      },
    }),
    await receiptFor(fixture.admission, fixture.executionRunId, {
      runtime: alternateRuntime,
    }),
    await receiptFor(fixture.admission, fixture.executionRunId, {
      sourceBytes: new TextEncoder().encode("result = different\n"),
    }),
    await receiptFor(fixture.admission, fixture.executionRunId, {
      output: { ...BUILD123D_EXECUTION_OUTPUT, basename: "other.step" },
    }),
    await receiptFor(fixture.admission, fixture.executionRunId, {
      publicationFingerprint: hash("8"),
    }),
  ];
  for (const receiptRecord of mismatchReceipts) {
    await assertRejects(
      () => createBuild123dExecutionDraft({ ...fixture.input, receiptRecord }),
      TypeError,
    );
  }

  const proofAdmission = validateBuild123dExecutionAdmission({
    ...fixture.admission,
    execution: {
      ...fixture.admission.execution,
      minimumDestructionAssurance: "proven",
    },
  });
  const acknowledged = await receiptFor(
    proofAdmission,
    fixture.executionRunId,
    { destruction: "acknowledged-unattested" },
  );
  await assertRejects(
    () =>
      createBuild123dExecutionDraft({
        ...fixture.input,
        admission: proofAdmission,
        receiptRecord: acknowledged,
      }),
    TypeError,
    "destruction assurance",
  );
});

Deno.test("Build123d capture rejects a detached draft reference and all schemas are exact", async () => {
  const fixture = await evidenceFixture();
  const draft = await createBuild123dExecutionDraft(fixture.input);
  const reference = await buildBuild123dExecutionDraftReference(draft);
  const capture = await createBuild123dExecutionCapture({
    ...fixture.input,
    draftReference: reference,
  });

  await assertRejects(
    () =>
      validateBuild123dExecutionCapture({
        ...capture,
        noncanonicalDraft: {
          ...reference,
          fingerprint: hash("7"),
          draftId: `build123d-execution-draft-${"7".repeat(64)}`,
        },
      }),
    TypeError,
    "does not name the exact execution draft",
  );
  await assertRejects(
    () => validateBuild123dExecutionDraft({ ...draft, provider: "sandbox" }),
    TypeError,
    "unsupported field provider",
  );
  assertThrows(
    () =>
      validateBuild123dExecutionDraftReference({
        ...reference,
        draftId: "build123d-execution-draft-foreign",
      }),
    TypeError,
    "must derive",
  );
  await assertRejects(
    () =>
      createBuild123dExecutionDraft({
        ...fixture.input,
        executionRunId: "build123d-execution-foreign",
      }),
    TypeError,
    "server-derived identity",
  );
  await assertRejects(
    () =>
      createBuild123dExecutionDraft({
        ...fixture.input,
        executedAt: "2026-08-13 12:34:56",
      }),
    TypeError,
    "canonical ISO-8601",
  );
});

interface EvidenceFixture {
  readonly admission: Build123dExecutionAdmission;
  readonly executionRunId: string;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly input: {
    readonly projectId: string;
    readonly basis: Build123dExecutionBasis;
    readonly agentRunId: string;
    readonly executionRunId: string;
    readonly decisionId: string;
    readonly executedAt: string;
    readonly admission: Build123dExecutionAdmission;
    readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  };
}

async function evidenceFixture(): Promise<EvidenceFixture> {
  const sourceSha256 = await fingerprintResourceBytes(SOURCE);
  const imageReference = `ghcr.io/casys-ai/build123d-runtime@sha256:${"c".repeat(64)}`;
  const runtime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits: limits(),
  });
  const admission = validateBuild123dExecutionAdmission({
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
      profile: {
        ...BUILD123D_EXECUTION_PROFILE,
        fingerprint: hash("a"),
      },
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
  const receipt = await receiptFor(admission, executionRunId, {
    producerGeneration: PRODUCER_GENERATION,
  });
  const basis: Build123dExecutionBasis = {
    kind: "thread-snapshot",
    snapshotId: "snapshot.8",
    revision: 8,
    subjectId: "subject.box",
    fingerprint: hash("d"),
  };
  return {
    admission,
    executionRunId,
    receipt,
    input: {
      projectId: PROJECT_ID,
      basis,
      agentRunId: AGENT_RUN_ID,
      executionRunId,
      decisionId: "decision.execute.build123d.1",
      executedAt: EXECUTED_AT,
      admission,
      receiptRecord: receipt,
    },
  };
}

interface ReceiptOverrides {
  readonly producerGeneration?: IsolatedOutputProducerGeneration;
  readonly profile?: { readonly id: string; readonly version: string };
  readonly policy?: Build123dExecutionAdmission["execution"]["isolationPolicy"];
  readonly runtime?: IsolatedCodeRuntimeAttestation;
  readonly sourceBytes?: Uint8Array;
  readonly output?: {
    readonly role: string;
    readonly basename: string;
    readonly mediaType: string;
    readonly format: string;
  };
  readonly destruction?: "proven" | "acknowledged-unattested";
  readonly publicationFingerprint?: { algorithm: "sha256"; digest: string };
}

async function receiptFor(
  admission: Build123dExecutionAdmission,
  executionRunId: string,
  overrides: ReceiptOverrides = {},
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const producerGeneration = overrides.producerGeneration ?? PRODUCER_GENERATION;
  const sourceBytes = overrides.sourceBytes ?? SOURCE;
  const sourceSha256 = await fingerprintResourceBytes(sourceBytes);
  const output = overrides.output ?? BUILD123D_EXECUTION_OUTPUT;
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: executionRunId,
    producerGeneration,
    profile: overrides.profile ?? BUILD123D_EXECUTION_PROFILE,
    source: { bytes: sourceBytes, sha256: sourceSha256 },
    policy: overrides.policy ?? admission.execution.isolationPolicy,
    outputs: [output],
  });
  const outputSha256 = await fingerprintResourceBytes(STEP);
  const publicationMember = {
    ...output,
    byteCount: STEP.byteLength,
    sha256: outputSha256,
    casUri: `casys://isolated-output/sha256/${outputSha256}`,
  };
  const outputRecord = {
    ...publicationMember,
    validation: "accepted" as const,
    persistence: "staged-reread-atomic-commit" as const,
  };
  const publicationFingerprint = overrides.publicationFingerprint ??
    await fingerprintIsolatedOutputPublicationManifest(
      executionRunId,
      producerGeneration,
      [publicationMember],
    );
  const destruction = overrides.destruction ?? "proven";
  const receipt = await createIsolatedCodeExecutionReceipt({
    request,
    runtime: overrides.runtime ?? runtimeOf(admission),
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs: [{ ...outputRecord, bytes: STEP }],
    destruction: destruction === "proven"
      ? {
        status: "proven",
        runId: executionRunId,
        proofFingerprint: hash("e"),
      }
      : {
        status: "acknowledged-unattested",
        runId: executionRunId,
        acknowledgementFingerprint: hash("f"),
      },
    publication: await createIsolatedOutputPublicationRef(
      executionRunId,
      producerGeneration,
      publicationFingerprint,
    ),
  });
  return isolatedCodeExecutionReceiptRecord(receipt);
}

function runtimeOf(
  admission: Build123dExecutionAdmission,
): IsolatedCodeRuntimeAttestation {
  return {
    isolationClass: admission.execution.runtime.isolationClass,
    imageDigest: admission.execution.runtime.imageDigest,
    requestedLimits: admission.execution.runtime.limits,
    limitAssurance: admission.execution.runtime.limitAssurance,
  };
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
