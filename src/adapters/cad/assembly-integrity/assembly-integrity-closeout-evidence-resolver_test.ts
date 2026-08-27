import { assertEquals, assertRejects } from "@std/assert";
import {
  AssemblyIntegrityCloseoutResolutionError,
  resolveAssemblyIntegrityCloseoutEvidence,
} from "./assembly-integrity-closeout-evidence-resolver.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  assemblyIntegrityEvaluationMethod,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const H = "2".repeat(64);
const AT = "2026-08-26T10:00:00.000Z";

Deno.test("L5 resolver selects the L4 artifact from the exact current producer run, not historical L4 evidence", async () => {
  const fixture = await closeoutFixture();

  const resolved = await resolveAssemblyIntegrityCloseoutEvidence(
    fixture.dependencies,
    fixture.input,
  );

  assertEquals(resolved.l4Run.id, "run-l4-current");
  assertEquals(
    resolved.evaluationCapture.id,
    `assembly-integrity-evaluation-${fixture.captureFingerprint.digest}`,
  );
  assertEquals(resolved.acceptanceEligible, true);
});

Deno.test("L5 resolver refuses reordered L4 module, STEP and observation inputs", async () => {
  const fixture = await closeoutFixture({ reorderedInputs: true });

  await assertRejects(
    () =>
      resolveAssemblyIntegrityCloseoutEvidence(
        fixture.dependencies,
        fixture.input,
      ),
    AssemblyIntegrityCloseoutResolutionError,
    "exactly consume",
  );
});

Deno.test("L5 resolver requires the L4 artifact version to name its exact capture digest", async () => {
  const fixture = await closeoutFixture({ l4Version: "not-the-capture-digest" });

  await assertRejects(
    () =>
      resolveAssemblyIntegrityCloseoutEvidence(
        fixture.dependencies,
        fixture.input,
      ),
    AssemblyIntegrityCloseoutResolutionError,
    "identity, URI, media type, or producer",
  );
});

async function closeoutFixture(options: {
  readonly reorderedInputs?: boolean;
  readonly l4Version?: string;
} = {}) {
  const capture = await validCapture();
  const captureFingerprint = await sha256Fingerprint(capture);
  const geometry = artifact({
    id: capture.geometryModule.artifactId,
    fingerprint: capture.geometryModule.fingerprint,
    kind: "cad-model",
    producer: "design.write-geometry@1",
  });
  const step = artifact({
    id: capture.assemblyStep.artifactId,
    fingerprint: capture.assemblyStep.fingerprint,
    kind: "step",
    mediaType: "model/step",
    producer: "design.write-geometry@1",
  });
  const observation = artifact({
    id: capture.observation.artifactId,
    fingerprint: capture.observation.fingerprint,
    kind: "evidence",
    producer: "verify.observe-assembly-integrity@1",
  });
  const currentL4 = artifact({
    id: `assembly-integrity-evaluation-${captureFingerprint.digest}`,
    fingerprint: captureFingerprint,
    kind: "evidence",
    mediaType: "application/json",
    uri: assemblyIntegrityEvaluationCaptureUri(captureFingerprint.digest),
    producer: "verify.evaluate-assembly-integrity@1",
    runId: "run-l4-current",
    ...(options.l4Version === undefined ? {} : { version: options.l4Version }),
    inputArtifactIds: options.reorderedInputs
      ? [step.id, geometry.id, observation.id]
      : [geometry.id, step.id, observation.id],
  });
  const historicalL4 = artifact({
    id: `assembly-integrity-evaluation-${H}`,
    fingerprint: fp(H),
    kind: "evidence",
    mediaType: "application/json",
    uri: assemblyIntegrityEvaluationCaptureUri(H),
    producer: "verify.evaluate-assembly-integrity@1",
    runId: "run-l4-historical",
    inputArtifactIds: [geometry.id, step.id, observation.id],
  });
  const snapshot = {
    id: "thread-assembly-r4",
    revision: 4,
    subject: { id: "assembly-subject" },
    freshness: { status: "fresh" },
    changeSet: { changes: [] },
    artifacts: [geometry, step, observation, historicalL4, currentL4],
  } as unknown as ThreadSnapshot;
  const reference = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: "assembly-subject",
  };
  const project = {
    project: { id: "project-assembly", subjectId: "assembly-subject" },
    agentRuns: [
      {
        id: "run-l4-historical",
        workItemId: "work-l4-historical",
        status: "completed",
        resultSnapshot: {
          snapshotId: "thread-assembly-r3",
          revision: 3,
          subjectId: "assembly-subject",
        },
        evidenceRefs: [],
      },
      {
        id: "run-l4-current",
        workItemId: "work-l4-current",
        status: "completed",
        basis: capture.basis,
        resultSnapshot: reference,
        evidenceRefs: [{
          snapshotId: snapshot.id,
          snapshotRevision: snapshot.revision,
          kind: "artifact",
          id: currentL4.id,
        }],
      },
    ],
    workItems: [
      {
        id: "work-l4-historical",
        status: "completed",
        operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
      },
      {
        id: "work-l4-current",
        status: "completed",
        operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
      },
    ],
  } as unknown as EngineeringProjectSnapshot;
  return {
    captureFingerprint,
    dependencies: {
      evaluationCaptures: {
        read: (fingerprint: { readonly digest: string }) =>
          Promise.resolve(
            fingerprint.digest === captureFingerprint.digest ? capture : undefined,
          ),
      },
    },
    input: {
      project,
      basis: { kind: "thread-snapshot" as const, ...reference },
      snapshot,
    },
  };
}

async function validCapture(): Promise<AssemblyIntegrityEvaluationCapture> {
  const method = await assemblyIntegrityEvaluationMethod();
  return await validateAssemblyIntegrityEvaluationCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-l4-current",
    evaluatedAt: AT,
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread-assembly-r3",
      revision: 3,
      subjectId: "assembly-subject",
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${A}`,
      fingerprint: fp(A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${A}-module-step-${B}`,
      fingerprint: fp(B),
    },
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0",
      artifactId: `assembly-integrity-observation-${C}`,
      fingerprint: fp(C),
      observationFingerprint: fp(D),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(E),
      byteCount: 1024,
    },
    method,
    evaluation: {
      method,
      criteria: [
        { id: "assembly-import", verdict: "pass" },
        { id: "occurrence-coverage", verdict: "pass" },
        { id: "placement-recross", verdict: "pass" },
        { id: "brep-validity", verdict: "pass" },
        { id: "pairwise-intersection", verdict: "pass" },
      ],
      verdict: "pass",
      measurementDiagnostics: { pairwiseLinearToleranceMm: [] },
    },
  });
}

function artifact(input: {
  readonly id: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly kind: ThreadArtifact["kind"];
  readonly producer: string;
  readonly runId?: string;
  readonly uri?: string;
  readonly mediaType?: string;
  readonly version?: string;
  readonly inputArtifactIds?: readonly string[];
}): ThreadArtifact {
  return {
    id: input.id,
    name: input.id,
    kind: input.kind,
    version: input.version ?? input.fingerprint.digest,
    fingerprint: input.fingerprint,
    ...(input.uri === undefined ? {} : { uri: input.uri }),
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    producer: {
      serverId: "digital-thread",
      tool: input.producer,
      runId: input.runId ?? "run-source",
    },
    inputArtifactIds: input.inputArtifactIds ?? [],
    freshness: {
      status: "fresh",
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
