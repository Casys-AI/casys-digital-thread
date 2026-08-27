import { assert, assertEquals } from "@std/assert";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  validateAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  assemblyIntegrityEvaluationCaptureUri,
  assemblyIntegrityEvaluationMethod,
  canonicalAssemblyIntegrityEvaluationCaptureText,
  createAssemblyIntegrityEvaluationCapture,
  fingerprintAssemblyIntegrityEvaluationCapture,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
} from "../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  canonicalAssemblyIntegrityEvaluationCloseoutCaptureText,
  validateAssemblyIntegrityEvaluationCloseoutCapture,
} from "../cad/assembly-integrity/assembly-integrity-evaluation-closeout-capture.ts";
import {
  assemblyIntegrityObservationCaptureUri,
  canonicalAssemblyIntegrityObservationCaptureText,
  createAssemblyIntegrityObservationCapture,
  fingerprintAssemblyIntegrityObservationCapture,
} from "../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY } from "../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import { enrichThreadWorkbenchWithAssemblyIntegrity } from "./assembly-integrity-workbench-enricher.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const G = "1".repeat(64);

Deno.test("Workbench projects a complete exact L3/L4/L5 assembly-integrity chain without provider raw data", async () => {
  const fixture = await workbenchFixture();
  const enriched = await enrichThreadWorkbenchWithAssemblyIntegrity(
    fixture.snapshot,
    fixture.readers,
  );
  const index = enriched.assemblyIntegrity!;
  const chain = index.chains[0]!;
  assertEquals(index.status, "current");
  assertEquals(chain.status, "current");
  assertEquals("aggregateVerdict" in chain.observation, false);
  assertEquals(chain.observation.facts.importability, {
    status: "observed",
    value: "imported",
  });
  assertEquals(chain.evaluation?.criteria.map((criterion) => criterion.id), [
    "assembly-import",
    "occurrence-coverage",
    "placement-recross",
    "brep-validity",
    "pairwise-intersection",
  ]);
  assertEquals(chain.evaluation?.aggregateVerdict, "pass");
  assertEquals(chain.closeout?.humanDisposition, "accept");
  assertEquals(chain.closeout?.gateClaims, [
    { gateItemId: "gate-assembly", role: "satisfies", status: "current" },
  ]);
  assertEquals(chain.closeout?.record.dependsOn, [chain.evaluation?.record.id]);
  const text = JSON.stringify(index);
  assertEquals(text.includes("provider-service"), false);
  assertEquals(text.includes("provider-engine"), false);
  assertEquals(text.includes("observe-facts"), false);
  assertEquals(text.includes('"execution"'), false);
});

Deno.test("Workbench retains a valid assembly-integrity chain as historical after a later Thread successor", async () => {
  const fixture = await workbenchFixture();
  const later = {
    ...fixture.snapshot,
    id: "assembly-thread-later",
    previous: { snapshotId: fixture.snapshot.id, revision: 6 },
  } as ThreadWorkbenchSnapshot;
  const enriched = await enrichThreadWorkbenchWithAssemblyIntegrity(
    later,
    fixture.readers,
  );
  assertEquals(enriched.assemblyIntegrity?.status, "historical");
  assertEquals(enriched.assemblyIntegrity?.chains[0]?.status, "historical");
});

Deno.test("Workbench marks the assembly-integrity family unresolved when ordered L4 lineage is corrupt", async () => {
  const fixture = await workbenchFixture();
  const corrupted = {
    ...fixture.snapshot,
    artifacts: fixture.snapshot.artifacts.map((artifact) =>
      artifact.id === fixture.evaluationArtifactId
        ? { ...artifact, dependsOn: [...artifact.dependsOn].reverse() }
        : artifact
    ),
  } as ThreadWorkbenchSnapshot;
  const enriched = await enrichThreadWorkbenchWithAssemblyIntegrity(
    corrupted,
    fixture.readers,
  );
  assertEquals(enriched.assemblyIntegrity?.status, "unresolved");
  assert(enriched.assemblyIntegrity?.chains.every((chain) => !chain.evaluation));
});

async function workbenchFixture() {
  const observation = {
    schemaVersion: "assembly-integrity-observation/1.0" as const,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
      fingerprint: fp(E),
      byteCount: 1,
    },
    method: {
      id: "assembly-integrity-factual-v1",
      version: "1.0.0",
      linearToleranceMm: 0.000001,
    },
    importability: { status: "observed" as const, value: "imported" as const },
    importFacts: {
      unitSystem: { status: "observed" as const, value: "mm" as const },
      solidCount: { status: "observed" as const, value: 1 },
    },
    topology: {
      brepValidity: { status: "observed" as const, value: "valid" as const },
      degenerateEdgeCount: { status: "observed" as const, value: 0 },
      freeEdgeCount: { status: "observed" as const, value: 0 },
      shellCount: { status: "observed" as const, value: 1 },
    },
    occurrences: [],
    pairs: [],
  };
  const l3 = await createAssemblyIntegrityObservationCapture({
    schemaVersion: "assembly-integrity-observation-capture/1.0",
    kind: "assembly-integrity-observation",
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-l3",
    observedAt: "2026-08-26T10:00:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "assembly-thread-l2",
      revision: 2,
      subjectId: "assembly-subject",
    },
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: "geometry-" + A,
      fingerprint: fp(A),
    },
    assemblyStep: {
      artifactId: "cad-asset-" + A + "-module-step-" + B,
      fingerprint: fp(B),
    },
    inputBundle: observation.inputBundle,
    profile: {
      id: "assembly-integrity-observer",
      version: "1.0.0",
      fingerprint: fp(C),
      configuredRuntime: { kind: "image-digest", imageDigest: fp(D) },
    },
    execution: {
      profile: {
        id: "assembly-integrity-observer",
        version: "1.0.0",
        fingerprint: fp(C),
      },
      configuredRuntime: { kind: "image-digest", imageDigest: fp(D) },
      raw: {
        schemaVersion: "factual-observation/1.0",
        producer: {
          service: "provider-service",
          packageVersion: "1.0.0",
          tool: "observe-facts",
          engine: { id: "provider-engine", version: "1.0.0" },
        },
        requestFingerprint: fp(E),
        responseFingerprint: fp(B),
      },
    },
    observation,
    limits: {
      verdict: "none",
      fitness: "none",
      safety: "none",
      motion: "none",
      strength: "none",
    },
  });
  const l3Fingerprint = await fingerprintAssemblyIntegrityObservationCapture(l3);
  const method = await assemblyIntegrityEvaluationMethod();
  const l4 = await createAssemblyIntegrityEvaluationCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId: "run-l4",
    evaluatedAt: "2026-08-26T10:01:00.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "assembly-thread-l3",
      revision: 3,
      subjectId: "assembly-subject",
    },
    geometryModule: l3.geometryModule,
    assemblyStep: l3.assemblyStep,
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0",
      artifactId: "assembly-integrity-observation-" + l3Fingerprint.digest,
      fingerprint: l3Fingerprint,
      observationFingerprint: l3.observationFingerprint,
    },
    inputBundle: l3.inputBundle,
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
  const l4Fingerprint = await fingerprintAssemblyIntegrityEvaluationCapture(l4);
  const admission = validateAssemblyIntegrityEvaluationCloseoutAdmission({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    consequence: "accept",
    rejectionDisposition: "none",
    projectId: "assembly-project",
    subjectId: "assembly-subject",
    approvedBriefBasis: {
      kind: "approved-brief",
      projectId: "assembly-project",
      projectSnapshotId: "assembly-project-r2",
      projectRevision: 2,
      briefId: "assembly-brief",
      briefSnapshotId: "assembly-brief-r2",
      briefRevision: 2,
      approvedBriefFingerprint: fp(G),
    },
    verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    gateClaims: [
      { gateItemId: "gate-assembly", role: "satisfies", status: "current" },
    ],
    basis: {
      snapshotId: "assembly-thread-l4",
      revision: 4,
      fingerprint: fp(G),
    },
    evaluationCapture: {
      id: "assembly-integrity-evaluation-" + l4Fingerprint.digest,
      fingerprint: l4Fingerprint,
    },
    geometryModule: {
      id: l3.geometryModule.artifactId,
      fingerprint: l3.geometryModule.fingerprint,
    },
    assemblyStep: {
      id: l3.assemblyStep.artifactId,
      fingerprint: l3.assemblyStep.fingerprint,
    },
    observation: {
      id: "assembly-integrity-observation-" + l3Fingerprint.digest,
      fingerprint: l3Fingerprint,
      observationFingerprint: l3.observationFingerprint,
    },
    method: {
      schemaVersion: method.schemaVersion,
      id: method.id,
      version: method.version,
      fingerprint: method.fingerprint,
    },
    criteria: l4.evaluation.criteria,
    limitations: method.limitations,
  });
  const l5 = validateAssemblyIntegrityEvaluationCloseoutCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    kind: "assembly-integrity-evaluation-closeout",
    operation: DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
    trustedRunId: "run-l5",
    decisionId: "assembly-closeout",
    sealedAt: "2026-08-26T10:02:00.000Z",
    admission,
    evaluationCapture: {
      id: admission.evaluationCapture.id,
      fingerprint: admission.evaluationCapture.fingerprint,
      uri: assemblyIntegrityEvaluationCaptureUri(l4Fingerprint.digest),
    },
    l4Limitations: method.limitations,
    limits: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_LIMITS,
  });
  const l5Fingerprint = await sha256Fingerprint(l5);
  const l3ArtifactId = "assembly-integrity-observation-" + l3Fingerprint.digest;
  const l4ArtifactId = "assembly-integrity-evaluation-" + l4Fingerprint.digest;
  const l5ArtifactId = "assembly-integrity-evaluation-closeout-" + l5Fingerprint.digest;
  const snapshot = {
    id: "assembly-thread-l5",
    subject: { id: "assembly-subject" },
    previous: { snapshotId: "assembly-thread-l4", revision: 4 },
    artifacts: [
      artifact(
        "geometry-" + A,
        A,
        "run-geometry",
        "design.write-geometry@1",
        "cad-model",
      ),
      artifact(
        "cad-asset-" + A + "-module-step-" + B,
        B,
        "run-geometry",
        "design.write-geometry@1",
        "step",
      ),
      artifact(
        l3ArtifactId,
        l3Fingerprint.digest,
        "run-l3",
        "verify.observe-assembly-integrity@1",
        "evidence",
        [l3.geometryModule.artifactId, l3.assemblyStep.artifactId],
        assemblyIntegrityObservationCaptureUri(l3Fingerprint.digest),
      ),
      artifact(
        l4ArtifactId,
        l4Fingerprint.digest,
        "run-l4",
        "verify.evaluate-assembly-integrity@1",
        "evidence",
        [l3.geometryModule.artifactId, l3.assemblyStep.artifactId, l3ArtifactId],
        assemblyIntegrityEvaluationCaptureUri(l4Fingerprint.digest),
      ),
      artifact(
        l5ArtifactId,
        l5Fingerprint.digest,
        "run-l5",
        "decide.accept-assembly-integrity-evaluation@1",
        "document",
        [l4ArtifactId],
        ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX + "sha256/" +
          l5Fingerprint.digest,
      ),
    ],
  } as unknown as ThreadWorkbenchSnapshot;
  const l3Text = await canonicalAssemblyIntegrityObservationCaptureText(l3);
  const l4Text = await canonicalAssemblyIntegrityEvaluationCaptureText(l4);
  const l5Text = canonicalAssemblyIntegrityEvaluationCloseoutCaptureText(l5);
  return {
    snapshot,
    evaluationArtifactId: l4ArtifactId,
    readers: {
      observations: {
        read: (fingerprint: { readonly digest: string }) =>
          Promise.resolve(
            fingerprint.digest === l3Fingerprint.digest ? l3Text : undefined,
          ),
      },
      evaluations: {
        read: (fingerprint: { readonly digest: string }) =>
          Promise.resolve(
            fingerprint.digest === l4Fingerprint.digest ? l4Text : undefined,
          ),
      },
      closeouts: {
        read: (fingerprint: { readonly digest: string }) =>
          Promise.resolve(
            fingerprint.digest === l5Fingerprint.digest ? l5Text : undefined,
          ),
      },
    },
  };
}

function artifact(
  id: string,
  digest: string,
  producerRunId: string,
  producedBy: string,
  kind: string,
  dependsOn: string[] = [],
  uri = "casys://fixture/sha256/" + digest,
) {
  return {
    id,
    label: id,
    kind,
    system: "digital-thread",
    revision: digest,
    freshness: "fresh" as const,
    fingerprint: "sha256:" + digest,
    uri,
    producedBy,
    producerRunId,
    dependsOn,
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
