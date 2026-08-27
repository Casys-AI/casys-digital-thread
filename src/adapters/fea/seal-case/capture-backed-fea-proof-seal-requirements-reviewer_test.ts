/**
 * Capture-backed proof-seal requirements admission: extra non-mechanical
 * units may coexist; every declared criterion and every capture row whose
 * unit is a V1 mechanical proof unit must still match exactly, including
 * when SysON feature names are arbitrary.
 */
import { assertEquals } from "@std/assert";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { REQUIREMENTS_CAPTURE_SCHEMA } from "../../architecture/requirements/requirements-capture.ts";
import { CaptureBackedFeaProofSealRequirementsReviewer } from "./capture-backed-fea-proof-seal-requirements-reviewer.ts";

const TARGET_ELEMENT_ID = "part-definition:plate";
const REQUIREMENTS_ELEMENT_ID = "requirement-usage:plate";
const EDITING_CONTEXT_ID = "editing-context:plate";
const COMPONENT = "StagePlate";
const REQ_DIGEST = "c".repeat(64);
const SEED_DIGEST = "d".repeat(64);
const ARTIFACT_ID = "artifact:requirements-plate";

const DISPLACEMENT = {
  id: "plate-deflection",
  name: "Maximum displacement",
  metric: "arm_max_displacement",
  operator: "<=" as const,
  limit: { value: 1, unit: "mm" as const },
};
const STRESS = {
  id: "plate-stress",
  name: "Maximum von Mises",
  metric: "arm_max_von_mises",
  operator: "<=" as const,
  limit: { value: 80_000_000, unit: "Pa" as const },
};
const UNRELATED = {
  id: "plate-temperature",
  name: "Maximum surface temperature",
  metric: "maxSurfaceTemperature",
  operator: "<=" as const,
  limit: { value: 373, unit: "K" },
};

Deno.test(
  "proof-seal requirements review accepts an unrelated extra capture criterion on the same component",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS, UNRELATED],
      declared: [displacementProof(), stressProof()],
    });
    assertEquals(result.status, "resolved");
    if (result.status === "resolved") {
      assertEquals(result.artifact.id, ARTIFACT_ID);
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses an omitted mechanical criterion even when its SysON feature is arbitrary",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS, UNRELATED],
      declared: [displacementProof()],
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics.map((item) => item.code), [
        "requirements-capture-invalid",
      ]);
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses a mismatched mechanical criterion",
  async () => {
    const result = await review({
      captured: [{ ...DISPLACEMENT, limit: { value: 5, unit: "mm" } }, STRESS],
      declared: [displacementProof(), stressProof()],
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics.map((item) => item.code), [
        "requirements-capture-invalid",
      ]);
    }
  },
);

async function review(input: {
  readonly captured: readonly CaptureRequirement[];
  readonly declared: MechanicalProofCase["requirements"];
}) {
  const captureText = JSON.stringify(requirementsCapture(input.captured));
  const reviewer = new CaptureBackedFeaProofSealRequirementsReviewer({
    requirementsCaptures: memoryReader({ [REQ_DIGEST]: captureText }),
    seedCaptures: memoryReader({ [SEED_DIGEST]: JSON.stringify(seedCapture()) }),
  });
  return await reviewer.review({
    snapshot: threadSnapshot(),
    proofCase: proofCase(input.declared),
  });
}

interface CaptureRequirement {
  readonly id: string;
  readonly name: string;
  readonly metric: string;
  readonly operator: "<=";
  readonly limit: { readonly value: number; readonly unit: string };
}

function displacementProof(): MechanicalProofCase["requirements"][number] {
  return {
    id: "proof-deflection",
    name: "maxDisplacement",
    metric: "maximum-displacement",
    feature: DISPLACEMENT.metric,
    operator: "<=",
    limit: DISPLACEMENT.limit,
  };
}

function stressProof(): MechanicalProofCase["requirements"][number] {
  return {
    id: "proof-stress",
    name: "maxVonMises",
    metric: "maximum-von-mises-stress",
    feature: STRESS.metric,
    operator: "<=",
    limit: STRESS.limit,
  };
}

function proofCase(
  requirements: MechanicalProofCase["requirements"],
): MechanicalProofCase {
  return {
    target: { modelElementId: TARGET_ELEMENT_ID },
    requirementsSource: {
      editingContextId: EDITING_CONTEXT_ID,
      elementId: REQUIREMENTS_ELEMENT_ID,
    },
    requirements,
  } as MechanicalProofCase;
}

function requirementsCapture(requirements: readonly CaptureRequirement[]) {
  return {
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements",
    containerComponent: COMPONENT,
    partDefName: `${COMPONENT}Requirements`,
    target: {
      kind: "part-definition",
      label: COMPONENT,
      elementId: TARGET_ELEMENT_ID,
    },
    architectureBasis: {
      snapshotId: "thread:plate:r2",
      revision: 2,
      fingerprint: "a".repeat(64),
    },
    requirements,
    seed: {
      artifactId: "artifact:seed",
      fingerprint: { algorithm: "sha256", digest: SEED_DIGEST },
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: "artifact:architecture",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run:architecture",
    },
    requirementsElementId: REQUIREMENTS_ELEMENT_ID,
    requirementUsage: {
      id: REQUIREMENTS_ELEMENT_ID,
      kind: "RequirementUsage",
    },
    constraintUsages: requirements.map((requirement) => ({
      requirementId: requirement.id,
      id: `constraint-usage:${requirement.id}`,
      kind: "ConstraintUsage",
      sourceId: `constraint-usage:${requirement.id}`,
    })),
    insertedAt: "2026-08-08T12:15:00.000Z",
  };
}

function seedCapture() {
  return {
    schemaVersion: "syson-model-seed-capture/2.0",
    kind: "syson-model-seed",
    scope: "sysml-container-identity",
    statement:
      "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.",
    capturedAt: "2026-08-09T10:00:00.000Z",
    trustedRunId: "run:seed",
    operation: { id: "architecture.seed-syson-model", version: "2" },
    lineage: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: "plate-proof",
        projectSnapshotId: "proj-snap-seed",
        projectRevision: 1,
        briefId: "brief-001",
        briefSnapshotId: "brief-snap-001",
        briefRevision: 1,
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "1".repeat(64),
        },
      },
      plan: {
        publishedAt: "2026-08-09T10:00:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      projectChange: {
        id: "change-001",
        commandId: "cmd-001",
        publishedAt: "2026-08-09T10:01:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      workItemId: "work-001",
      baseSnapshot: {
        snapshotId: "snap-r1",
        revision: 1,
        subjectId: "project:plate-proof",
      },
      documentaryArtifact: {
        id: "doc-artifact-001",
        fingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
        uri: `casys://approved-brief-capture/sha256/${"2".repeat(64)}`,
        producerRunId: "run-baseline",
      },
    },
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults: {
      project: {
        id: "syson-proj",
        name: "Plate Proof",
        editingContextId: EDITING_CONTEXT_ID,
      },
      document: { id: "syson-doc", name: "Plate", kind: "SysML" },
      rootPackage: { id: "syson-pkg", kind: "Package", label: "Plate" },
    },
  };
}

function threadSnapshot(): ThreadSnapshot {
  const digest = REQ_DIGEST;
  const artifact: ThreadArtifact = {
    id: ARTIFACT_ID,
    name: `${COMPONENT} requirements`,
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/${COMPONENT}/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-requirements@1",
      runId: "run:requirements",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-16T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
  return {
    artifacts: [artifact],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
}

function memoryReader(
  captures: Readonly<Record<string, string>>,
): { read(fingerprint: ContentFingerprint): Promise<string | undefined> } {
  return {
    read: (fingerprint) => Promise.resolve(captures[fingerprint.digest]),
  };
}
