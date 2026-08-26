import { assertEquals, assertRejects } from "@std/assert";
import type { Build123dExecutionCaptureStore } from "../../../ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import type { ProjectIsolatedGeometrySealReviewCommand } from "../../../ports/in/cad/sealed-isolated/project-isolated-geometry-seal-review.ts";
import {
  createBuild123dExecutionCapture,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  validateBuild123dExecutionAdmission,
} from "../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { parseIsolatedGeometrySealParameters } from "../../../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  PrepareProjectIsolatedGeometrySealReview,
  ProjectIsolatedGeometrySealReviewError,
} from "./prepare-project-isolated-geometry-seal-review.ts";

const AT = "2026-08-14T00:00:00.000Z";
const PROJECT_ID = "project.isolated-geometry";
const SUBJECT_ID = "subject.isolated-geometry";

Deno.test("isolated geometry seal review derives canonical MRTR from one execution capture", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);
  const replay = parseIsolatedGeometrySealParameters(result.decisionParameters);

  assertEquals(result.admission, replay);
  assertEquals(result.admission.executionCapture, {
    id: fixture.command.artifactId,
    fingerprint: fixture.command.artifactFingerprint,
  });
  assertEquals(result.admission.step, {
    ...BUILD123D_EXECUTION_OUTPUT,
    sha256: fixture.stepSha256,
    byteCount: 4,
  });
  assertEquals(
    result.admission.draft.draftId,
    fixture.capture.noncanonicalDraft.draftId,
  );
  assertEquals(
    result.admission.publication.fingerprint,
    fixture.capture.publicationRef.fingerprint,
  );
});

Deno.test("isolated geometry seal review rejects a missing execution capture", async () => {
  const fixture = await harness();
  fixture.captures.missing = true;
  await assertRejects(
    () => fixture.service.execute(fixture.command),
    ProjectIsolatedGeometrySealReviewError,
    "unavailable",
  );
});

async function harness() {
  const source = new TextEncoder().encode(
    "from build123d import Box\nresult = Box(20, 10, 2)\n",
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const imageReference = `ghcr.io/casys-ai/build123d-runtime@sha256:${"c".repeat(64)}`;
  const runtime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits: {
      maxWallTimeMs: 30_000,
      maxCpuTimeMs: 20_000,
      maxMemoryBytes: 1_073_741_824,
      maxProcesses: 32,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 33_554_432,
      maxOutputTotalBytes: 33_554_432,
    },
  });
  const executionAdmission = validateBuild123dExecutionAdmission({
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
    "run.execute.build123d",
  );
  const step = new TextEncoder().encode("STEP");
  const stepSha256 = await fingerprintResourceBytes(step);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: executionRunId,
    producerGeneration: 0,
    profile: BUILD123D_EXECUTION_PROFILE,
    source: { bytes: source, sha256: sourceSha256 },
    policy: executionAdmission.execution.isolationPolicy,
    outputs: [BUILD123D_EXECUTION_OUTPUT],
  });
  const publicationMember = {
    ...BUILD123D_EXECUTION_OUTPUT,
    byteCount: step.byteLength,
    sha256: stepSha256,
    casUri: `casys://isolated-output/sha256/${stepSha256}`,
  };
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: executionAdmission.execution.runtime.isolationClass,
        imageDigest: executionAdmission.execution.runtime.imageDigest,
        requestedLimits: executionAdmission.execution.runtime.limits,
        limitAssurance: executionAdmission.execution.runtime.limitAssurance,
      },
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: [{
        ...publicationMember,
        bytes: step,
      }],
      destruction: {
        status: "proven",
        runId: executionRunId,
        proofFingerprint: hash("d"),
      },
      publication: await createIsolatedOutputPublicationRef(
        executionRunId,
        0,
        await fingerprintIsolatedOutputPublicationManifest(
          executionRunId,
          0,
          [publicationMember],
        ),
      ),
    }),
  );
  const input = {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.r1",
      revision: 1,
      subjectId: SUBJECT_ID,
      fingerprint: hash("e"),
    },
    agentRunId: "run.execute.build123d",
    executionRunId,
    decisionId: "decision.execute.build123d",
    executedAt: AT,
    admission: executionAdmission,
    receiptRecord: receipt,
  };
  const draft = await createBuild123dExecutionDraft(input);
  const draftFingerprint = await sha256Fingerprint(draft);
  const capture = await createBuild123dExecutionCapture({
    ...input,
    draftReference: {
      schemaVersion: "build123d-execution-draft-reference/1.0",
      draftId: `build123d-execution-draft-${draftFingerprint.digest}`,
      fingerprint: draftFingerprint,
    },
  });
  const captureFingerprint = await sha256Fingerprint(capture);
  const artifactId = `build123d-execution-capture-${captureFingerprint.digest}`;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.r2",
    revision: 2,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Isolated geometry",
      kind: "system",
      version: "r2",
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "change-set.execution",
      name: "Execution",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.execution",
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded the isolated execution document.",
        afterFingerprint: captureFingerprint,
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Build123d execution capture",
      kind: "document",
      version: captureFingerprint.digest,
      fingerprint: captureFingerprint,
      uri: `casys://build123d-execution-capture/sha256/${captureFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "design.execute-build123d@1",
        runId: "run.execute.build123d",
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.execution",
      relation: "changes",
      from: { kind: "change", id: "change.execution" },
      to: { kind: "artifact", id: artifactId },
      rationale: "Created the execution document.",
    }],
    proposedActions: [],
  });
  const command: ProjectIsolatedGeometrySealReviewCommand = {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot",
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    artifactId,
    artifactFingerprint: captureFingerprint,
  };
  const captures = new FakeCaptureStore(capture, captureFingerprint);
  const service = new PrepareProjectIsolatedGeometrySealReview({
    snapshots: {
      get: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      latest: () => Promise.resolve(snapshot),
      save: () => Promise.reject(new Error("review must not write snapshots")),
    },
    captures,
  });
  return { service, command, capture, captures, stepSha256 };
}

class FakeCaptureStore implements Build123dExecutionCaptureStore {
  missing = false;
  constructor(
    readonly capture: Awaited<ReturnType<typeof createBuild123dExecutionCapture>>,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("review must not persist captures"));
  }
  read(fingerprint: ContentFingerprint) {
    if (this.missing || fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.capture);
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `casys://build123d-execution-capture/sha256/${fingerprint.digest}`;
  }
}

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}
